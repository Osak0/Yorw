"""Default builtin parser set; external Docling is opt-in by configuration."""
from .registry import ParserRegistry


def default_registry(docling_config=None) -> ParserRegistry:
    from .doc import DocParser
    from .docx import DocxParser
    from .markdown import MarkdownParser
    from .pdf import PdfParser
    from .text import TextParser
    parsers = [PdfParser(), TextParser(), MarkdownParser(), DocxParser(), DocParser()]
    if docling_config is not None:
        from .docling import DoclingParser
        parsers.append(DoclingParser(docling_config))
    return ParserRegistry(parsers)
