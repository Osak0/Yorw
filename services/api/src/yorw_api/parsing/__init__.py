"""Versioned document parsing contracts and builtin adapters."""
from .base import DocumentParser, ParseError
from .contracts import (BlockType, Capability, ContentBlock, ParseMetadata, ParseRequest, ParseResult,
                        ParseWarning, SourceEvidence, SourceLocation, config_fingerprint,
                        evidence_ref, stable_block_id)
from .registry import DEFAULT_FORMATS, ParserRegistry

__all__ = [
    'BlockType', 'Capability', 'ContentBlock', 'DEFAULT_FORMATS', 'DocumentParser', 'ParseError',
    'ParseMetadata', 'ParseRequest', 'ParseResult', 'ParseWarning', 'ParserRegistry', 'SourceEvidence',
    'SourceLocation', 'config_fingerprint', 'evidence_ref', 'stable_block_id',
]
