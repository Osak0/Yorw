"""Builtin PDF text extraction expressed through the parser contract."""
from threading import Event

from pypdf import PdfReader
from pypdf.errors import DependencyError, FileNotDecryptedError

from .base import ParseError
from .contracts import (Capability, ContentBlock, ParseMetadata, ParseRequest, ParseResult,
                        ParseWarning, SourceLocation, config_fingerprint, stable_block_id)

MAX_PAGES = 2000
MAX_PAGE_TEXT = 200_000
MAX_TOTAL_TEXT = 10_000_000
MEDIA_TYPE = 'application/pdf'


class PdfParser:
    name = 'builtin-pdf'
    version = 'pypdf-text-1'

    def capabilities(self) -> list[Capability]:
        return [Capability(format='pdf', media_type=MEDIA_TYPE, state='builtin', parser=self.name,
                           detail='内置 PDF 文字抽取；不包含 OCR')]

    def _result(self, request: ParseRequest, **values) -> ParseResult:
        return ParseResult(
            format='pdf', media_type=MEDIA_TYPE, parser_name=self.name, parser_version=self.version,
            config_fingerprint=config_fingerprint({'parser': self.name, 'version': self.version,
                                                    'max_pages': MAX_PAGES, 'max_page_text': MAX_PAGE_TEXT,
                                                    'max_total_text': MAX_TOTAL_TEXT}),
            **values)

    def parse(self, request: ParseRequest, cancel: Event) -> ParseResult:
        if cancel.is_set():
            raise ParseError('CANCELLED')
        try:
            with request.path.open('rb') as stream:
                reader = PdfReader(stream)
                if reader.is_encrypted:
                    raise ParseError('ENCRYPTED_PDF')
                page_count = len(reader.pages)
                metadata = self._metadata(reader)
                if page_count > MAX_PAGES:
                    return self._result(request, status='unsupported', warning='PAGE_LIMIT',
                                        summary=f'超过 {MAX_PAGES} 页上限', metadata=metadata,
                                        page_count=page_count)
                blocks: list[ContentBlock] = []
                warnings: list[ParseWarning] = []
                failures = 0
                total_text = 0
                for number, page in enumerate(reader.pages, 1):
                    if cancel.is_set():
                        raise ParseError('CANCELLED')
                    try:
                        text = page.extract_text() or ''
                    except Exception:
                        failures += 1
                        warnings.append(ParseWarning(code='PAGE_TEXT_FAILED', block_ordinal=len(blocks),
                                                     message=f'第 {number} 页文字抽取失败'))
                        continue
                    if len(text) > MAX_PAGE_TEXT:
                        text = text[:MAX_PAGE_TEXT]
                        failures += 1
                        warnings.append(ParseWarning(code='PAGE_TEXT_TRUNCATED', block_ordinal=len(blocks),
                                                     message=f'第 {number} 页文字超过单页上限'))
                    remaining = max(0, MAX_TOTAL_TEXT - total_text)
                    if len(text) > remaining:
                        text = text[:remaining]
                        failures += 1
                        warnings.append(ParseWarning(code='TOTAL_TEXT_TRUNCATED', block_ordinal=len(blocks),
                                                     message='全文字数超过上限，后续页面未纳入'))
                    if not text.strip():
                        continue
                    ordinal = len(blocks)
                    blocks.append(ContentBlock(
                        id=stable_block_id(request.document_id, request.extraction_version, ordinal),
                        ordinal=ordinal, type='page', text=text, physical_page=number,
                        location=SourceLocation(kind='page', physical_page=number, block_ordinal=ordinal)))
                    total_text += len(text)
                    if total_text >= MAX_TOTAL_TEXT:
                        failures += 1
                        warnings.append(ParseWarning(code='TOTAL_TEXT_TRUNCATED', message='全文字数达到上限'))
                        break
        except ParseError:
            raise
        except (DependencyError, FileNotDecryptedError):
            raise ParseError('ENCRYPTED_PDF') from None
        except Exception:
            raise ParseError('PDF_PARSE_FAILED') from None
        if not blocks:
            return self._result(request, status='unsupported', warning='NO_TEXT_NO_OCR',
                                summary='没有可提取文字', metadata=metadata, page_count=page_count)
        status = 'partial' if failures or len(blocks) < page_count else 'ready'
        warning = 'PARTIAL_TEXT' if status == 'partial' else None
        return self._result(request, status=status, warning=warning,
                            summary=f'{len(blocks)} 页有文字 / 共 {page_count} 页',
                            metadata=metadata, page_count=page_count, blocks=blocks, warnings=warnings)

    @staticmethod
    def _metadata(reader: PdfReader) -> ParseMetadata:
        try:
            info = reader.metadata
            title = str(info.title)[:1000] if info and info.title else None
            authors = [str(info.author)[:1000]] if info and info.author else []
            return ParseMetadata(title=title, authors=authors)
        except Exception:
            return ParseMetadata()
