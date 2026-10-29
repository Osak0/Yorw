"""Parser settings, capability detection and explicit reparse entry points."""
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .library import Library, now
from .parsing import DoclingConfig, DoclingParser, default_registry
from .parsing.doc import find_soffice
from .storage.database import Database


class ParserSettingsInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    approved: bool = False
    enhanced_enabled: bool = Field(strict=True)
    docling_executable: str = Field(default='', max_length=1000)
    docling_prefix: list[str] = Field(default_factory=list, max_length=16)
    libreoffice_executable: str = Field(default='', max_length=1000)
    timeout_seconds: float = Field(default=600, ge=1, le=3600)
    ocr_enabled: bool = Field(default=True, strict=True)
    ocr_mode: Literal['default', 'full_page'] = 'default'
    ocr_engine: Literal['auto', 'easyocr', 'rapidocr', 'tesseract'] = 'auto'
    version: int = Field(ge=0, strict=True)


class ReparseInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    processor: Literal['builtin', 'enhanced'] = 'builtin'


class ParserService:
    def __init__(self, database: Database):
        self.db = database
        self.approved = False

    def settings(self) -> dict:
        import json
        with self.db.lock:
            cursor = self.db.connection.execute('SELECT * FROM parser_settings WHERE singleton=1')
            row = cursor.fetchone()
            names = [item[0] for item in cursor.description]
            result = dict(zip(names, row))
        result['enhanced_enabled'] = bool(result['enhanced_enabled'])
        result['ocr_enabled'] = bool(result['ocr_enabled'])
        try:
            result['docling_prefix'] = json.loads(result.pop('docling_prefix_json') or '[]')
        except (TypeError, ValueError):
            result['docling_prefix'] = []
        return result

    def save(self, value: ParserSettingsInput) -> dict:
        import json
        if value.docling_prefix not in ([], ['-m', 'docling']):
            raise HTTPException(422, detail='INVALID_INPUT')
        with self.db.write() as conn:
            if self.settings()['version'] != value.version:
                raise HTTPException(409, detail='CONFIG_CONFLICT')
            conn.execute(
                'UPDATE parser_settings SET enhanced_enabled=?,docling_executable=?,docling_prefix_json=?,'
                'libreoffice_executable=?,timeout_seconds=?,ocr_enabled=?,ocr_mode=?,ocr_engine=?,version=version+1 WHERE singleton=1',
                (int(value.enhanced_enabled), value.docling_executable.strip(),
                 json.dumps(value.docling_prefix, ensure_ascii=False), value.libreoffice_executable.strip(),
                 value.timeout_seconds, int(value.ocr_enabled), value.ocr_mode, value.ocr_engine))
        self.approved = value.approved
        return self.settings()

    def docling_config(self) -> DoclingConfig:
        value = self.settings()
        if not self.approved:
            value = {**value, 'docling_executable': '', 'docling_prefix': [], 'libreoffice_executable': ''}
        return DoclingConfig(
            executable=value['docling_executable'], prefix_args=value['docling_prefix'],
            libreoffice_executable=value['libreoffice_executable'] if self.approved else '',
            timeout_seconds=value['timeout_seconds'], ocr=value['ocr_enabled'],
            ocr_mode=value['ocr_mode'], ocr_engine=value['ocr_engine'])

    def enhanced_available(self, format: str, automatic=False):
        # Queuing an import must not execute a slow component probe under a DB lock.
        # The worker validates actual capabilities against its captured config.
        from pathlib import Path
        config = self.docling_config()
        return (self.approved and format in ('pdf', 'docx', 'doc', 'md')
                and bool(config.executable) and Path(config.executable).is_file()
                and (not automatic or self.settings()['enhanced_enabled']))

    def registry(self, enhanced=False):
        return default_registry(self.docling_config(), include_external=enhanced)

    def external_capability(self, format: str, parser: DoclingParser | None = None) -> dict | None:
        parser = parser or DoclingParser(self.docling_config())
        for capability in parser.capabilities():
            if capability.format == format:
                return {**capability.model_dump(mode='json'), 'processor': 'docling'}
        return None

    def capability(self, processor: str, format: str) -> dict | None:
        if processor == 'enhanced':
            return self.external_capability(format)
        capability = self.registry().capability(format)
        return {**capability.model_dump(mode='json'), 'processor': 'builtin'}

    def components(self, force=False, parser: DoclingParser | None = None) -> dict:
        parser = parser or DoclingParser(self.docling_config())
        available, version, detail = parser.detect(force=force)
        settings = self.settings()
        soffice = find_soffice(self.docling_config().libreoffice_executable)
        return {
            'docling': {'available': available, 'version': version, 'detail': detail},
            'libreoffice': {'available': bool(soffice), 'path': soffice or ''},
        }

    def status(self, force=False) -> dict:
        parser = DoclingParser(self.docling_config())
        if force:
            parser.detect(force=True)
        builtins = self.registry().capabilities()
        capabilities = [{**item.model_dump(mode='json'), 'processor': 'builtin'} for item in builtins]
        if not force:
            return {'settings': self.settings(), 'capabilities': capabilities, 'components': {
                'docling': {'available': False, 'version': '', 'detail': '请授权并显式检测'},
                'libreoffice': {'available': False, 'path': ''}}}
        for format in ('pdf', 'docx', 'doc', 'md'):
            external = self.external_capability(format, parser)
            if external:
                capabilities.append(external)
        return {'settings': self.settings(), 'capabilities': capabilities,
                'components': self.components(force=False, parser=parser)}

    def test(self) -> dict:
        result = self.status(force=True)
        result['tested_at'] = now()
        return result


def router(service: ParserService, library: Library):
    routes = APIRouter()

    @routes.get('/v1/parsers')
    def status():
        return service.status(force=False)

    @routes.put('/v1/parsers')
    def save(value: ParserSettingsInput):
        return service.save(value)

    @routes.post('/v1/parsers/approve')
    def approve(value: ParserSettingsInput):
        current = service.settings()
        if any(getattr(value, key) != current[key] for key in type(value).model_fields if key != 'approved'):
            raise HTTPException(409, detail='CONFIG_CONFLICT')
        if value.docling_prefix not in ([], ['-m', 'docling']):
            raise HTTPException(422, detail='INVALID_INPUT')
        service.approved = True
        return {'approved': True}

    @routes.post('/v1/parsers/test')
    def test():
        return service.test()

    @routes.post('/v1/documents/{identity}/reparse')
    def reparse(identity: str, value: ReparseInput):
        return library.reparse(identity, value.processor)

    return routes
