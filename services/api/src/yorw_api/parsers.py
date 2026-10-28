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
        with self.db.write() as conn:
            if self.settings()['version'] != value.version:
                raise HTTPException(409, detail='CONFIG_CONFLICT')
            conn.execute(
                'UPDATE parser_settings SET enhanced_enabled=?,docling_executable=?,docling_prefix_json=?,'
                'libreoffice_executable=?,timeout_seconds=?,ocr_enabled=?,ocr_mode=?,ocr_engine=?,version=version+1 WHERE singleton=1',
                (int(value.enhanced_enabled), value.docling_executable.strip(),
                 json.dumps(value.docling_prefix, ensure_ascii=False), value.libreoffice_executable.strip(),
                 value.timeout_seconds, int(value.ocr_enabled), value.ocr_mode, value.ocr_engine))
        return self.settings()

    def docling_config(self) -> DoclingConfig:
        value = self.settings()
        return DoclingConfig(
            executable=value['docling_executable'], prefix_args=value['docling_prefix'],
            libreoffice_executable=value['libreoffice_executable'] or None,
            timeout_seconds=value['timeout_seconds'], ocr=value['ocr_enabled'],
            ocr_mode=value['ocr_mode'], ocr_engine=value['ocr_engine'])

    def registry(self):
        return default_registry(self.docling_config())

    def external_capability(self, format: str, parser: DoclingParser | None = None) -> dict | None:
        parser = parser or DoclingParser(self.docling_config())
        for capability in parser.capabilities():
            if capability.format == format:
                return {**capability.model_dump(mode='json'), 'processor': 'docling'}
        return None

    def capability(self, processor: str, format: str) -> dict | None:
        if processor == 'enhanced':
            return self.external_capability(format)
        capability = default_registry().capability(format)
        return {**capability.model_dump(mode='json'), 'processor': 'builtin'}

    def components(self, force=False, parser: DoclingParser | None = None) -> dict:
        parser = parser or DoclingParser(self.docling_config())
        available, version, detail = parser.detect(force=force)
        settings = self.settings()
        soffice = find_soffice(settings['libreoffice_executable'] or None)
        return {
            'docling': {'available': available, 'version': version, 'detail': detail},
            'libreoffice': {'available': bool(soffice), 'path': soffice or ''},
        }

    def status(self, force=False) -> dict:
        parser = DoclingParser(self.docling_config())
        if force:
            parser.detect(force=True)
        builtins = default_registry().capabilities()
        capabilities = [{**item.model_dump(mode='json'), 'processor': 'builtin'} for item in builtins]
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
        return service.status(force=True)

    @routes.put('/v1/parsers')
    def save(value: ParserSettingsInput):
        return service.save(value)

    @routes.post('/v1/parsers/test')
    def test():
        return service.test()

    @routes.post('/v1/documents/{identity}/reparse')
    def reparse(identity: str, value: ReparseInput):
        return library.reparse(identity, value.processor)

    return routes
