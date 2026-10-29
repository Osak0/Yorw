"""Parser boundary and standard error codes."""
from threading import Event
from typing import Protocol

from .contracts import Capability, ParseRequest, ParseResult


class ParseError(RuntimeError):
    """A safe parser failure that can be shown or recorded without internals."""

    def __init__(self, code: str, message: str = '', *, retryable: bool = False,
                 diagnostic: dict | None = None):
        if not code.isupper():
            raise ValueError('parse error codes are uppercase')
        super().__init__(code)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.diagnostic = diagnostic or {}

    def __str__(self):
        return self.code


class DocumentParser(Protocol):
    """Builtin and external adapters implement only this surface."""

    name: str
    version: str

    def capabilities(self) -> list[Capability]:
        ...

    def parse(self, request: ParseRequest, cancel: Event) -> ParseResult:
        ...
