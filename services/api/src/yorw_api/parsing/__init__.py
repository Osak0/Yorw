"""Versioned document parsing contracts and builtin adapters."""
from .base import DocumentParser, ParseError
from .contracts import (BlockType, Capability, ContentBlock, ParseMetadata, ParseRequest, ParseResult,
                        ParseWarning, SourceEvidence, SourceLocation, config_fingerprint,
                        evidence_ref, stable_block_id)
from .defaults import default_registry
from .docling import DoclingConfig, DoclingParser
from .registry import DEFAULT_FORMATS, ParserRegistry

__all__ = [
    'BlockType', 'Capability', 'ContentBlock', 'DEFAULT_FORMATS', 'DoclingConfig', 'DoclingParser',
    'DocumentParser', 'ParseError', 'ParseMetadata', 'ParseRequest', 'ParseResult', 'ParseWarning',
    'ParserRegistry', 'SourceEvidence', 'SourceLocation', 'config_fingerprint', 'default_registry',
    'evidence_ref', 'stable_block_id',
]
