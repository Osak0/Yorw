"""Builtin Markdown structure: headings, paragraphs, lists, tables and code."""
from __future__ import annotations

import re
from threading import Event

from .base import ParseError
from .contracts import (Capability, ContentBlock, ParseMetadata, ParseRequest, ParseResult,
                        SourceLocation, config_fingerprint, stable_block_id)
from .text import decode_text

MEDIA_TYPE = 'text/markdown'
MAX_FILE_BYTES = 50 * 1024 * 1024
HEADING = re.compile(r'^(#{1,6})\s+(.*?)\s*#*\s*$')
LIST = re.compile(r'^\s*(?:[-*+]|\d+[.)])\s+')
FENCE = re.compile(r'^\s*(```|~~~)')
TABLE_SEPARATOR = re.compile(r'^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$')


class MarkdownParser:
    name = 'builtin-markdown'
    version = 'markdown-common-1'

    def capabilities(self) -> list[Capability]:
        return [Capability(format='md', media_type=MEDIA_TYPE, state='builtin', parser=self.name,
                           detail='内置 Markdown 标题、段落、列表与基础表格解析')]

    def parse(self, request: ParseRequest, cancel: Event) -> ParseResult:
        if cancel.is_set():
            raise ParseError('CANCELLED')
        if request.path.stat().st_size > MAX_FILE_BYTES:
            raise ParseError('FILE_TOO_LARGE')
        text, _, warnings = decode_text(request.path.read_bytes())
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        lines = text.splitlines(keepends=True)
        offsets = []
        cursor = 0
        for line in lines:
            offsets.append(cursor)
            cursor += len(line)
        blocks: list[ContentBlock] = []
        headings: list[tuple[int, str]] = []
        title = None

        def add(kind, value, start, end, level=None, section=None):
            value = value.strip()
            if not value:
                return
            for offset in range(0, len(value), 200_000):
                if cancel.is_set():
                    raise ParseError('CANCELLED')
                piece = value[offset:offset + 200_000]
                ordinal = len(blocks)
                blocks.append(ContentBlock(
                    id=stable_block_id(request.document_id, request.extraction_version, ordinal),
                    ordinal=ordinal, type=kind, text=piece,
                    section_path=list(section or []), heading_level=level,
                    location=SourceLocation(kind='block', block_ordinal=ordinal,
                                            start_offset=start + offset,
                                            end_offset=min(end, start + offset + len(piece)))))
        index = 0
        while index < len(lines):
            if cancel.is_set():
                raise ParseError('CANCELLED')
            line = lines[index]
            stripped = line.strip()
            if not stripped:
                index += 1
                continue
            start = offsets[index]
            fence = FENCE.match(line)
            if fence:
                marker = fence.group(1)
                end_index = index + 1
                while end_index < len(lines) and not lines[end_index].strip().startswith(marker):
                    end_index += 1
                content = ''.join(lines[index + 1:end_index])
                end = offsets[min(end_index, len(lines) - 1)] + (len(lines[min(end_index, len(lines) - 1)]) if end_index < len(lines) else 0)
                add('code', content, start, end, section=[item for _, item in headings])
                index = min(end_index + 1, len(lines))
                continue
            heading = HEADING.match(stripped)
            if heading:
                level = len(heading.group(1))
                value = heading.group(2).strip()
                while headings and headings[-1][0] >= level:
                    headings.pop()
                add('heading', value, start, offsets[index] + len(line), level=level,
                    section=[item for _, item in headings])
                headings.append((level, value))
                title = title or (value if level == 1 else None)
                index += 1
                continue
            if index + 1 < len(lines) and index + 1 < len(offsets):
                underline = lines[index + 1].strip()
                if underline and set(underline) <= {'=', '-'} and len(underline) >= 3:
                    level = 1 if underline[0] == '=' else 2
                    value = stripped
                    while headings and headings[-1][0] >= level:
                        headings.pop()
                    add('heading', value, start, offsets[index + 1] + len(lines[index + 1]), level=level,
                        section=[item for _, item in headings])
                    headings.append((level, value))
                    title = title or (value if level == 1 else None)
                    index += 2
                    continue
            if '|' in stripped and index + 1 < len(lines) and TABLE_SEPARATOR.match(lines[index + 1]):
                end_index = index + 2
                while end_index < len(lines) and '|' in lines[end_index] and lines[end_index].strip():
                    end_index += 1
                end = offsets[end_index - 1] + len(lines[end_index - 1])
                add('table', ''.join(lines[index:end_index]), start, end,
                    section=[item for _, item in headings])
                index = end_index
                continue
            if LIST.match(line):
                add('list_item', stripped, start, start + len(line),
                    section=[item for _, item in headings])
                index += 1
                continue
            if stripped.startswith('>'):
                end_index = index
                values = []
                while end_index < len(lines) and lines[end_index].strip().startswith('>'):
                    values.append(lines[end_index].strip()[1:].lstrip())
                    end_index += 1
                end = offsets[end_index - 1] + len(lines[end_index - 1])
                add('quote', '\n'.join(values), start, end, section=[item for _, item in headings])
                index = end_index
                continue
            end_index = index + 1
            while end_index < len(lines) and lines[end_index].strip():
                candidate = lines[end_index].strip()
                if HEADING.match(candidate) or FENCE.match(lines[end_index]) or LIST.match(lines[end_index]) or candidate.startswith('>'):
                    break
                if '|' in candidate and end_index + 1 < len(lines) and TABLE_SEPARATOR.match(lines[end_index + 1]):
                    break
                end_index += 1
            end = offsets[end_index - 1] + len(lines[end_index - 1])
            add('paragraph', text[start:end], start, end, section=[item for _, item in headings])
            index = end_index
        if not blocks:
            return ParseResult(format='md', media_type=MEDIA_TYPE, parser_name=self.name,
                               parser_version=self.version,
                               config_fingerprint=config_fingerprint({'parser': self.name, 'version': self.version}),
                               status='unsupported', warning='NO_TEXT', summary='没有可提取内容',
                               metadata=ParseMetadata(), blocks=[])
        return ParseResult(format='md', media_type=MEDIA_TYPE, parser_name=self.name,
                           parser_version=self.version,
                           config_fingerprint=config_fingerprint({'parser': self.name, 'version': self.version}),
                           status='ready', summary=f'{len(blocks)} 个内容块',
                           metadata=ParseMetadata(title=title), blocks=blocks, warnings=warnings)
