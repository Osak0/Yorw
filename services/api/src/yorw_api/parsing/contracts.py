"""Stable contracts shared by builtin and external document parsers.

Callers consume ParseResult and its blocks; parser-private types never cross
this boundary. Block IDs are deterministic for a document extraction version
so citations can be resolved without trusting parser internals.
"""
from hashlib import sha256
import json
from pathlib import Path
from typing import Literal
from uuid import NAMESPACE_URL, uuid5

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

BlockType = Literal['page', 'heading', 'paragraph', 'list_item', 'table', 'code', 'quote', 'other']
ParseStatus = Literal['ready', 'partial', 'unsupported', 'failed']
CapabilityState = Literal['builtin', 'external', 'component_missing', 'unsupported']


def stable_block_id(document_id: str, extraction_version: int, ordinal: int) -> str:
    """Deterministic within one extraction version; a reparse creates new IDs."""
    return str(uuid5(NAMESPACE_URL, f'yorw:block:{document_id}:{extraction_version}:{ordinal}'))


class SourceLocation(BaseModel):
    """Where a block came from. Non-PDF formats never invent a page number."""
    model_config = ConfigDict(extra='forbid')
    kind: Literal['page', 'block']
    physical_page: int | None = Field(default=None, ge=1)
    block_ordinal: int | None = Field(default=None, ge=0)
    start_offset: int | None = Field(default=None, ge=0)
    end_offset: int | None = Field(default=None, ge=0)

    @model_validator(mode='after')
    def check_location(self):
        if self.kind == 'page' and self.physical_page is None:
            raise ValueError('page location requires physical_page')
        if self.kind == 'block' and self.physical_page is not None:
            raise ValueError('block location must not fabricate a physical page')
        if self.start_offset is not None and self.end_offset is not None and self.end_offset < self.start_offset:
            raise ValueError('end_offset precedes start_offset')
        return self


class ContentBlock(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=64)
    ordinal: int = Field(ge=0, strict=True)
    type: BlockType
    text: str = Field(min_length=1)
    section_path: list[str] = Field(default_factory=list, max_length=64)
    physical_page: int | None = Field(default=None, ge=1)
    heading_level: int | None = Field(default=None, ge=1, le=6)
    location: SourceLocation

    @field_validator('text')
    @classmethod
    def text_not_blank(cls, value: str):
        if not value.strip():
            raise ValueError('block text is blank')
        return value

    @model_validator(mode='after')
    def check_page_consistency(self):
        if self.physical_page is not None:
            if self.location.kind != 'page' or self.location.physical_page != self.physical_page:
                raise ValueError('physical_page must match a page location')
        elif self.location.kind == 'page':
            raise ValueError('page location requires block physical_page')
        if self.type == 'page' and self.physical_page is None:
            raise ValueError('page block requires a physical page')
        return self


class ParseMetadata(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    title: str | None = Field(default=None, max_length=1000)
    authors: list[str] = Field(default_factory=list, max_length=100)
    year: int | None = Field(default=None, ge=1000, le=9999)


class ParseWarning(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str = Field(pattern=r'^[A-Z_]+$', max_length=64)
    message: str = Field(default='', max_length=500)
    block_ordinal: int | None = Field(default=None, ge=0)


class ParseRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', arbitrary_types_allowed=True)
    path: Path
    document_id: str = Field(min_length=1, max_length=64)
    extraction_version: int = Field(ge=1, strict=True)
    format: str = Field(min_length=1, max_length=16)
    original_name: str = Field(min_length=1, max_length=255)
    parser_name: str | None = Field(default=None, max_length=128)
    options: dict = Field(default_factory=dict)

    @field_validator('format')
    @classmethod
    def normalize_format(cls, value: str):
        return value.strip().lower().lstrip('.')


class ParseResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    format: str = Field(min_length=1, max_length=16)
    media_type: str = Field(min_length=1, max_length=128)
    parser_name: str = Field(min_length=1, max_length=128)
    parser_version: str = Field(min_length=1, max_length=64)
    config_fingerprint: str = Field(min_length=1, max_length=128)
    status: ParseStatus
    summary: str = Field(default='', max_length=1000)
    warning: str | None = Field(default=None, max_length=64)
    metadata: ParseMetadata = Field(default_factory=ParseMetadata)
    page_count: int | None = Field(default=None, ge=1)
    blocks: list[ContentBlock] = Field(default_factory=list, max_length=200_000)
    warnings: list[ParseWarning] = Field(default_factory=list, max_length=10_000)

    @field_validator('format')
    @classmethod
    def normalize_format(cls, value: str):
        return value.strip().lower().lstrip('.')

    @model_validator(mode='after')
    def check_status(self):
        if self.status in ('ready', 'partial') and not self.blocks:
            raise ValueError('ready or partial parse requires content blocks')
        if self.warning is not None and not self.warning.isupper():
            raise ValueError('warning codes are uppercase')
        return self


class Capability(BaseModel):
    """One format's current processing availability for the UI."""
    model_config = ConfigDict(extra='forbid')
    format: str = Field(min_length=1, max_length=16)
    media_type: str = Field(default='application/octet-stream', max_length=128)
    state: CapabilityState
    parser: str = Field(default='', max_length=128)
    detail: str = Field(default='', max_length=500)
    install_hint: str | None = Field(default=None, max_length=1000)

    @field_validator('format')
    @classmethod
    def normalize_format(cls, value: str):
        return value.strip().lower().lstrip('.')


class SourceEvidence(BaseModel):
    """Citation evidence that accepts both new block IDs and legacy chunk IDs."""
    model_config = ConfigDict(extra='forbid')
    document_id: str = Field(min_length=1, max_length=64)
    document_title: str = Field(default='', max_length=1000)
    block_id: str | None = Field(default=None, min_length=1, max_length=64)
    chunk_id: str | None = Field(default=None, min_length=1, max_length=64)
    block_type: str | None = Field(default=None, max_length=32)
    section_path: list[str] = Field(default_factory=list, max_length=64)
    physical_page: int | None = Field(default=None, ge=1)
    quote: str = Field(default='', max_length=200_000)
    extraction_version: int = Field(ge=1, strict=True)

    @model_validator(mode='after')
    def require_identity(self):
        if not self.block_id and not self.chunk_id:
            raise ValueError('evidence requires block_id or chunk_id')
        return self


def evidence_ref(block: ContentBlock, *, document_id: str, document_title: str,
                 extraction_version: int, chunk_id: str | None = None) -> dict:
    """Build a citation snapshot without dropping legacy PDF fields."""
    return SourceEvidence(
        document_id=document_id, document_title=document_title, block_id=block.id,
        chunk_id=chunk_id, block_type=block.type, section_path=block.section_path,
        physical_page=block.physical_page, quote=block.text,
        extraction_version=extraction_version,
    ).model_dump(mode='json')


def config_fingerprint(values: dict) -> str:
    return sha256(json.dumps(values, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()
