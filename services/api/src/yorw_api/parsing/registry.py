"""Format-to-parser selection and capability reporting."""
from threading import Event

from .base import DocumentParser, ParseError
from .contracts import Capability, ParseRequest, ParseResult

DEFAULT_FORMATS = ('pdf', 'docx', 'doc', 'md', 'txt')
STATE_PRIORITY = {'builtin': 3, 'external': 2, 'component_missing': 1, 'unsupported': 0}


class ParserRegistry:
    def __init__(self, parsers: list[DocumentParser] | None = None,
                 formats: tuple[str, ...] = DEFAULT_FORMATS):
        self.parsers = list(parsers or [])
        self.formats = tuple(item.strip().lower().lstrip('.') for item in formats)

    def _entries(self, format: str) -> list[tuple[Capability, DocumentParser]]:
        result = []
        for parser in self.parsers:
            for capability in parser.capabilities():
                if capability.format == format:
                    result.append((capability, parser))
        return result

    def capabilities(self) -> list[Capability]:
        formats = list(self.formats)
        for parser in self.parsers:
            for capability in parser.capabilities():
                if capability.format not in formats:
                    formats.append(capability.format)
        result = []
        for format in formats:
            entries = self._entries(format)
            if not entries:
                result.append(Capability(format=format, state='unsupported', parser='',
                                         detail='当前版本不支持该格式'))
                continue
            entry = max(entries, key=lambda item: STATE_PRIORITY[item[0].state])
            result.append(entry[0])
        return result

    def capability(self, format: str) -> Capability:
        normalized = format.strip().lower().lstrip('.')
        for item in self.capabilities():
            if item.format == normalized:
                return item
        return Capability(format=normalized, state='unsupported', detail='当前版本不支持该格式')

    def parser_for(self, request: ParseRequest) -> DocumentParser:
        entries = self._entries(request.format)
        if request.parser_name:
            entries = [entry for entry in entries if entry[0].parser == request.parser_name or entry[1].name == request.parser_name]
            if not entries:
                raise ParseError('UNSUPPORTED_FORMAT', 'requested parser does not support this format')
        available = [entry for entry in entries if entry[0].state in ('builtin', 'external')]
        if available:
            return available[0][1]
        missing = [entry for entry in entries if entry[0].state == 'component_missing']
        if missing:
            capability = missing[0][0]
            raise ParseError('COMPONENT_MISSING', capability.detail, diagnostic={'install_hint': capability.install_hint})
        raise ParseError('UNSUPPORTED_FORMAT', 'no parser supports this format')

    def parse(self, request: ParseRequest, cancel: Event | None = None) -> ParseResult:
        parser = self.parser_for(request)
        result = parser.parse(request, cancel or Event())
        if not isinstance(result, ParseResult):
            raise ParseError('PARSER_CONTRACT_VIOLATION', 'parser returned a non-contract result')
        if result.format != request.format:
            raise ParseError('PARSER_CONTRACT_VIOLATION', 'parser returned a different format')
        return result
