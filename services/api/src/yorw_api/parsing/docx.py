"""Builtin DOCX extraction from OOXML with explicit layout degradation."""
from __future__ import annotations

import re
from threading import Event
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from .base import ParseError
from .contracts import (Capability, ContentBlock, ParseMetadata, ParseRequest, ParseResult,
                        ParseWarning, SourceLocation, config_fingerprint, stable_block_id)
from .text import decode_text

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
DC = '{http://purl.org/dc/elements/1.1/}'
DCTERMS = '{http://purl.org/dc/terms/}'
MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
MAX_UNCOMPRESSED = 64 * 1024 * 1024
MAX_ENTRIES = 512


def attr(element, name):
    return element.get(W + name) if element is not None else None


def safe_xml(data: bytes):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ParseError('INVALID_FILE', 'DOCX XML 包含不支持的 DTD')
    try:
        return ElementTree.fromstring(data)
    except ElementTree.ParseError:
        raise ParseError('INVALID_FILE', 'DOCX XML 损坏') from None


def text_of(element) -> str:
    parts = []
    for node in element.iter():
        if node.tag == W + 't':
            parts.append(node.text or '')
        elif node.tag == W + 'tab':
            parts.append('\t')
        elif node.tag in (W + 'br', W + 'cr'):
            parts.append('\n')
        elif node.tag == W + 'noBreakHyphen':
            parts.append('-')
    return ''.join(parts).strip()


class DocxParser:
    name = 'builtin-docx'
    version = 'ooxml-docx-1'
    format = 'docx'
    media_type = MEDIA_TYPE

    def capabilities(self) -> list[Capability]:
        return [Capability(format='docx', media_type=MEDIA_TYPE, state='builtin', parser=self.name,
                           detail='内置 DOCX 标题、段落、列表与基础表格解析；复杂布局降级')]

    def parse(self, request: ParseRequest, cancel: Event) -> ParseResult:
        return self.parse_path(request, cancel, format=self.format, media_type=self.media_type,
                               parser_name=self.name, parser_version=self.version)

    def parse_path(self, request: ParseRequest, cancel: Event, *, format: str, media_type: str,
                   parser_name: str, parser_version: str) -> ParseResult:
        if cancel.is_set():
            raise ParseError('CANCELLED')
        try:
            with ZipFile(request.path) as archive:
                infos = archive.infolist()
                if len(infos) > MAX_ENTRIES or sum(info.file_size for info in infos) > MAX_UNCOMPRESSED:
                    raise ParseError('FILE_TOO_LARGE')
                try:
                    document = safe_xml(archive.read('word/document.xml'))
                    styles = self._styles(archive)
                    numbering = self._numbering(archive)
                    metadata = self._metadata(archive)
                except KeyError:
                    raise ParseError('INVALID_FILE', 'DOCX 缺少 document.xml') from None
        except BadZipFile:
            raise ParseError('INVALID_FILE', 'DOCX 不是有效的 OOXML 压缩包') from None
        body = document.find(W + 'body')
        if body is None:
            raise ParseError('INVALID_FILE', 'DOCX 缺少 body')
        blocks: list[ContentBlock] = []
        headings: list[tuple[int, str]] = []
        warnings: list[ParseWarning] = []
        counters: dict[tuple[str, int], int] = {}
        title = metadata.title
        seen_image = False

        def add(kind, value, level=None):
            value = (value or '').strip()
            if not value:
                return
            if cancel.is_set():
                raise ParseError('CANCELLED')
            for offset in range(0, len(value), 200_000):
                ordinal = len(blocks)
                blocks.append(ContentBlock(
                    id=stable_block_id(request.document_id, request.extraction_version, ordinal),
                    ordinal=ordinal, type=kind, text=value[offset:offset + 200_000],
                    section_path=[item for _, item in headings], heading_level=level,
                    location=SourceLocation(kind='block', block_ordinal=ordinal)))

        def walk(container):
            nonlocal title, seen_image
            for child in container:
                if cancel.is_set():
                    raise ParseError('CANCELLED')
                if child.tag == W + 'p':
                    if any(node.tag in (W + 'drawing', W + 'pict') for node in child.iter()):
                        if not seen_image:
                            seen_image = True
                            warnings.append(ParseWarning(code='IMAGE_SKIPPED', message='图片未做语义理解，仅保留文字内容'))
                    if any(node.tag == W + 'txbxContent' for node in child.iter()):
                        warnings.append(ParseWarning(code='COMPLEX_LAYOUT_DEGRADED', message='文本框内容按普通文本降级'))
                    value = text_of(child)
                    if not value:
                        continue
                    style = child.find(f'{W}pPr/{W}pStyle')
                    style_id = attr(style, 'val')
                    level = self._heading_level(child, style_id, styles)
                    numbered = child.find(f'{W}pPr/{W}numPr')
                    if numbered is not None:
                        value = self._list_text(numbered, numbering, counters) + value
                        add('list_item', value)
                    elif level == 0:
                        if title is None:
                            title = value[:1000]
                    elif level is not None:
                        while headings and headings[-1][0] >= level:
                            headings.pop()
                        add('heading', value, level=min(level, 6))
                        headings.append((level, value))
                    else:
                        add('paragraph', value)
                elif child.tag == W + 'tbl':
                    table, degraded = self._table(child)
                    if degraded:
                        warnings.append(ParseWarning(code='COMPLEX_TABLE_DEGRADED', message='嵌套或复杂表格已降级为文本'))
                    add('table', table)
                elif child.tag == W + 'sdt':
                    content = child.find(W + 'sdtContent')
                    if content is not None:
                        walk(content)
                elif child.tag in (W + 'customXml',):
                    walk(child)
                elif child.tag == W + 'sectPr':
                    continue
                else:
                    if any(node.tag in (W + 'drawing', W + 'pict', W + 'txbxContent') for node in child.iter()):
                        warnings.append(ParseWarning(code='COMPLEX_LAYOUT_DEGRADED', message='复杂布局已降级'))

        walk(body)
        if title and not metadata.title:
            metadata = ParseMetadata(title=title, authors=metadata.authors, year=metadata.year)
        if not blocks:
            return ParseResult(format=format, media_type=media_type, parser_name=parser_name,
                               parser_version=parser_version,
                               config_fingerprint=config_fingerprint({'parser': parser_name, 'version': parser_version}),
                               status='unsupported', warning='NO_TEXT', summary='没有可提取文字',
                               metadata=metadata, blocks=[])
        status = 'partial' if warnings else 'ready'
        return ParseResult(format=format, media_type=media_type, parser_name=parser_name,
                           parser_version=parser_version,
                           config_fingerprint=config_fingerprint({'parser': parser_name, 'version': parser_version}),
                           status=status, warning='PARTIAL_TEXT' if status == 'partial' else None,
                           summary=f'{len(blocks)} 个内容块', metadata=metadata, blocks=blocks,
                           warnings=warnings)

    @staticmethod
    def _styles(archive: ZipFile) -> dict[str, dict]:
        if 'word/styles.xml' not in archive.namelist():
            return {}
        try:
            root = safe_xml(archive.read('word/styles.xml'))
        except (ParseError, KeyError):
            return {}
        result = {}
        for style in root.findall(W + 'style'):
            identity = attr(style, 'styleId')
            if not identity:
                continue
            name = attr(style.find(W + 'name'), 'val') or ''
            based = attr(style.find(W + 'basedOn'), 'val')
            outline = attr(style.find(f'{W}pPr/{W}outlineLvl'), 'val')
            result[identity] = {'name': name, 'based': based, 'outline': outline}
        return result

    def _heading_level(self, paragraph, style_id, styles) -> int | None:
        outline = attr(paragraph.find(f'{W}pPr/{W}outlineLvl'), 'val')
        if outline is not None:
            try:
                level = int(outline) + 1
                if 1 <= level <= 9:
                    return level
            except ValueError:
                pass
        seen = set()
        while style_id and style_id not in seen:
            seen.add(style_id)
            info = styles.get(style_id)
            if not info:
                break
            name = info['name'].strip().lower()
            match = re.match(r'(?:heading|标题)\s*([1-9])', name)
            if match:
                return int(match.group(1))
            if name == 'title':
                return 0
            if info.get('outline') is not None:
                try:
                    level = int(info['outline']) + 1
                    if 1 <= level <= 9:
                        return level
                except ValueError:
                    pass
            style_id = info.get('based')
        return None

    @staticmethod
    def _numbering(archive: ZipFile) -> dict[str, dict[int, dict]]:
        if 'word/numbering.xml' not in archive.namelist():
            return {}
        try:
            root = safe_xml(archive.read('word/numbering.xml'))
        except (ParseError, KeyError):
            return {}
        abstracts = {}
        for abstract in root.findall(W + 'abstractNum'):
            identity = attr(abstract, 'abstractNumId')
            levels = {}
            for level in abstract.findall(W + 'lvl'):
                levels[int(attr(level, 'ilvl') or 0)] = {
                    'fmt': attr(level.find(W + 'numFmt'), 'val') or 'bullet',
                    'start': int(attr(level.find(W + 'start'), 'val') or 1),
                }
            abstracts[identity] = levels
        result = {}
        for number in root.findall(W + 'num'):
            num_id = attr(number, 'numId')
            abstract_id = attr(number.find(W + 'abstractNumId'), 'val')
            if num_id and abstract_id in abstracts:
                result[num_id] = abstracts[abstract_id]
        return result

    @staticmethod
    def _list_text(numbered, numbering, counters) -> str:
        num_id = attr(numbered.find(W + 'numId'), 'val') or ''
        level = int(attr(numbered.find(W + 'ilvl'), 'val') or 0)
        spec = numbering.get(num_id, {}).get(level, {})
        fmt = spec.get('fmt', 'bullet')
        if fmt == 'decimal':
            key = (num_id, level)
            counters[key] = counters.get(key, spec.get('start', 1) - 1) + 1
            return f'{counters[key]}. '
        return '• '

    @staticmethod
    def _table(table) -> tuple[str, bool]:
        rows = []
        degraded = False
        for row in table.findall(W + 'tr'):
            cells = []
            for cell in row.findall(W + 'tc'):
                if any(node.tag == W + 'tbl' for node in cell.iter()):
                    degraded = True
                values = [text_of(paragraph) for paragraph in cell.findall(W + 'p')]
                cells.append(' '.join(value for value in values if value))
            if any(cells):
                rows.append(' | '.join(cells))
        return '\n'.join(rows), degraded

    @staticmethod
    def _metadata(archive: ZipFile) -> ParseMetadata:
        if 'docProps/core.xml' not in archive.namelist():
            return ParseMetadata()
        try:
            root = safe_xml(archive.read('docProps/core.xml'))
        except (ParseError, KeyError):
            return ParseMetadata()
        title = (root.findtext(DC + 'title') or '').strip()[:1000] or None
        creator = (root.findtext(DC + 'creator') or '').strip()[:1000]
        created = (root.findtext(DCTERMS + 'created') or '').strip()
        year = None
        match = re.match(r'(\d{4})', created)
        if match and 1000 <= int(match.group(1)) <= 9999:
            year = int(match.group(1))
        return ParseMetadata(title=title, authors=[creator] if creator else [], year=year)
