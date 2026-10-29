"""Builtin plain-text decoding and paragraph blocks."""
from __future__ import annotations

import codecs
import re
from threading import Event

from .base import ParseError
from .contracts import (Capability, ContentBlock, ParseMetadata, ParseRequest, ParseResult,
                        ParseWarning, SourceLocation, config_fingerprint, stable_block_id)

MEDIA_TYPE = 'text/plain'
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_BLOCK_TEXT = 200_000


def decode_text(raw: bytes) -> tuple[str, str, list[ParseWarning]]:
    """Strict BOM/UTF-8 first, then GB18030 for common Chinese text files."""
    try:
        if raw.startswith(codecs.BOM_UTF8):
            return raw.decode('utf-8-sig'), 'utf-8-sig', []
        if raw.startswith(codecs.BOM_UTF16_LE) or raw.startswith(codecs.BOM_UTF16_BE):
            return raw.decode('utf-16'), 'utf-16', []
    except UnicodeDecodeError:
        raise ParseError('DECODE_FAILED', '文本编码与 BOM 不符') from None
    try:
        return raw.decode('utf-8'), 'utf-8', []
    except UnicodeDecodeError:
        pass
    try:
        return raw.decode('gb18030'), 'gb18030', [
            ParseWarning(code='TEXT_ENCODING_INFERRED', message='未检测到 BOM，按 GB18030 解码')]
    except UnicodeDecodeError:
        raise ParseError('DECODE_FAILED', '无法可靠识别文本编码') from None


class TextParser:
    name = 'builtin-text'
    version = 'text-utf8-paragraph-v1'

    def capabilities(self) -> list[Capability]:
        return [Capability(format='txt', media_type=MEDIA_TYPE, state='builtin', parser=self.name,
                           detail='内置纯文本段落解析；无 OCR')]

    def parse(self, request: ParseRequest, cancel: Event) -> ParseResult:
        if cancel.is_set():
            raise ParseError('CANCELLED')
        if request.path.stat().st_size > MAX_FILE_BYTES:
            raise ParseError('FILE_TOO_LARGE')
        raw = request.path.read_bytes()
        text, encoding, warnings = decode_text(raw)
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        blocks: list[ContentBlock] = []
        for match in re.finditer(r'(?:[^\n]|\n(?!\s*\n))+', text):
            if cancel.is_set():
                raise ParseError('CANCELLED')
            value = match.group(0)
            start, end = match.start(), match.end()
            while value and value[0].isspace():
                value, start = value[1:], start + 1
            while value and value[-1].isspace():
                value, end = value[:-1], end - 1
            if not value:
                continue
            for offset in range(0, len(value), MAX_BLOCK_TEXT):
                if cancel.is_set():
                    raise ParseError('CANCELLED')
                piece = value[offset:offset + MAX_BLOCK_TEXT]
                ordinal = len(blocks)
                blocks.append(ContentBlock(
                    id=stable_block_id(request.document_id, request.extraction_version, ordinal),
                    ordinal=ordinal, type='paragraph', text=piece,
                    section_path=[], location=SourceLocation(
                        kind='block', block_ordinal=ordinal,
                        start_offset=start + offset, end_offset=start + offset + len(piece))))
        if not blocks:
            return ParseResult(format='txt', media_type=MEDIA_TYPE, parser_name=self.name,
                               parser_version=self.version,
                               config_fingerprint=config_fingerprint({'parser': self.name, 'version': self.version}),
                               status='unsupported', warning='NO_TEXT', summary='没有可提取文字',
                               metadata=ParseMetadata(), blocks=[])
        status = 'ready'
        return ParseResult(format='txt', media_type=MEDIA_TYPE, parser_name=self.name,
                           parser_version=self.version,
                           config_fingerprint=config_fingerprint({'parser': self.name, 'version': self.version}),
                           status=status, warning=None,
                           summary=f'{len(blocks)} 个段落（{encoding}）', metadata=ParseMetadata(),
                           blocks=blocks, warnings=warnings)
