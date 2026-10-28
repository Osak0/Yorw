"""DOC conversion through a user-installed LibreOffice, then the DOCX parser."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
from tempfile import mkdtemp
from threading import Event

from .base import ParseError
from .contracts import Capability, ParseRequest, ParseResult, ParseWarning, config_fingerprint
from .docx import DocxParser
from .process import run_bounded

MEDIA_TYPE = 'application/msword'
MAX_FILE_BYTES = 50 * 1024 * 1024
INSTALL_HINT = ('DOC 需要用户安装 LibreOffice。安装后重新检测；'
                'Yorw 不随包附带、不静默下载或自动安装。')

def find_soffice(configured: str | None = None) -> str | None:
    if configured is not None:
        return configured if configured and Path(configured).is_file() else None
    found = shutil.which('soffice')
    if found:
        return found
    for variable in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
        base = os.environ.get(variable)
        if not base:
            continue
        candidate = Path(base) / 'LibreOffice' / 'program' / 'soffice.exe'
        if candidate.is_file():
            return str(candidate)
    return None


class DocParser:
    name = 'builtin-doc'
    version = 'libreoffice-docx-1'

    def __init__(self, soffice: str | None = None, timeout_seconds: float = 180,
                 max_output_bytes: int = 8 * 1024 * 1024):
        self.soffice = soffice
        self.timeout_seconds = timeout_seconds
        self.max_output_bytes = max_output_bytes

    def capabilities(self) -> list[Capability]:
        if find_soffice(self.soffice):
            return [Capability(format='doc', media_type=MEDIA_TYPE, state='builtin', parser=self.name,
                               detail='DOC 经用户安装的 LibreOffice 转为 DOCX 后解析')]
        return [Capability(format='doc', media_type=MEDIA_TYPE, state='component_missing', parser=self.name,
                           detail='未检测到 LibreOffice，无法转换 DOC', install_hint=INSTALL_HINT)]

    def parse(self, request: ParseRequest, cancel: Event) -> ParseResult:
        if cancel.is_set():
            raise ParseError('CANCELLED')
        if request.path.stat().st_size > MAX_FILE_BYTES:
            raise ParseError('FILE_TOO_LARGE')
        soffice = find_soffice(self.soffice)
        if not soffice:
            raise ParseError('COMPONENT_MISSING', '未检测到 LibreOffice', diagnostic={'install_hint': INSTALL_HINT})
        output_dir = Path(mkdtemp(prefix='yorw-doc-'))
        try:
            profile = output_dir / 'profile'
            command = [soffice, '--headless', '--safe-mode', '--norestore', '--nolockcheck',
                       f'-env:UserInstallation={profile.as_uri()}',
                       '--convert-to', 'docx', '--outdir', str(output_dir), str(request.path)]
            code, _, stderr = run_bounded(command, self.timeout_seconds, cancel, self.max_output_bytes)
            if code != 0:
                raise ParseError('PARSER_FAILED', 'LibreOffice 转换 DOC 失败',
                                 diagnostic={'exit_code': code,
                                             'stderr': stderr[-2000:].decode('utf-8', 'replace')})
            converted = output_dir / f'{request.path.stem}.docx'
            if not converted.is_file():
                candidates = [path for path in output_dir.glob('*.docx') if path.is_file()]
                if not candidates:
                    raise ParseError('OUTPUT_MISSING', 'LibreOffice 未生成 DOCX')
                converted = candidates[0]
            result = DocxParser().parse_path(
                request.model_copy(update={'path': converted}), cancel,
                format='doc', media_type=MEDIA_TYPE, parser_name=self.name, parser_version=self.version)
            warnings = result.warnings + [ParseWarning(code='DOC_CONVERTED', message='DOC 已通过 LibreOffice 转换后解析')]
            return result.model_copy(update={
                'warnings': warnings,
                'config_fingerprint': config_fingerprint({'parser': self.name, 'version': self.version,
                                                          'converter': 'libreoffice'}),
            })
        finally:
            shutil.rmtree(output_dir, ignore_errors=True)
