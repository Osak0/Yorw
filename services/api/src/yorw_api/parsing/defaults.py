"""Default builtin parser set; external Docling is opt-in by configuration."""
from .registry import ParserRegistry


def default_registry(docling_config=None, include_external=True) -> ParserRegistry:
    from .doc import DocParser
    from .docx import DocxParser
    from .markdown import MarkdownParser
    from .pdf import PdfParser
    from .text import TextParser
    parsers = [PdfParser(), TextParser(), MarkdownParser(), DocxParser(), DocParser(soffice=docling_config.libreoffice_executable if docling_config else None,
        timeout_seconds=docling_config.timeout_seconds if docling_config else 180)]
    if docling_config is not None and include_external:
        from .docling import DoclingParser
        parsers.append(DoclingParser(docling_config))
    return ParserRegistry(parsers)
