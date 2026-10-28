"""External Docling adapter over a user-owned executable and local process.

Docling and its models are never bundled or installed by Yorw. The adapter only
runs an explicitly configured executable, passes a sanitized environment,
bounds time/output, kills the process tree on cancel, and maps Docling JSON to
Yorw content blocks. Document text stays in the user's workspace; no secrets are
passed to the child.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
from tempfile import mkdtemp
from threading import Event, Thread
import time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .base import ParseError
from .contracts import (Capability, ContentBlock, ParseMetadata, ParseRequest, ParseResult,
                        ParseWarning, SourceLocation, config_fingerprint, stable_block_id)

MAX_BLOCK_TEXT = 200_000
MAX_BLOCKS = 100_000
MAX_TOTAL_TEXT = 10_000_000
CREATE_NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

FORMATS = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'md': 'text/markdown',
}

INSTALL_HINT = (
    '在独立环境中安装 Docling，例如：uv tool install "docling[easyocr]"；'
    '然后在 House 配置 docling 可执行文件路径。Yorw 不会自动下载或安装组件。'
)
DOC_INSTALL_HINT = (
    'DOC 需要 Docling 与 LibreOffice。安装 LibreOffice 后重新检测；'
    '或先将 DOC 另存为 DOCX 再导入。'
)

_ALLOWED_ENV = {
    'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE',
    'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES',
    'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES', 'COMSPEC', 'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE', 'OS', 'LANG', 'LC_ALL', 'PYTHONIOENCODING', 'PYTHONUTF8',
    'HF_HOME', 'TRANSFORMERS_CACHE', 'TORCH_HOME', 'XDG_CACHE_HOME', 'TESSDATA_PREFIX',
    'OMP_NUM_THREADS', 'CUDA_VISIBLE_DEVICES', 'CUDA_PATH',
}
_ALLOWED_PREFIXES = ('DOCLING_', 'HF_', 'TORCH_', 'CUDA_', 'TESSDATA_', 'LIBREOFFICE_', 'LC_')
_FORBIDDEN_PARTS = ('KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'AUTH', 'CREDENTIAL')


def sanitized_environment() -> dict[str, str]:
    """Pass only runtime/cache variables; never provider keys or auth tokens."""
    result = {}
    for name, value in os.environ.items():
        upper = name.upper()
        if any(part in upper for part in _FORBIDDEN_PARTS):
            continue
        if name in _ALLOWED_ENV or upper.startswith(_ALLOWED_PREFIXES):
            result[name] = value
    result.setdefault('NO_COLOR', '1')
    result.setdefault('TERM', 'dumb')
    result.setdefault('PYTHONIOENCODING', 'utf-8')
    return result


class DoclingConfig(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    executable: str = ''
    prefix_args: list[str] = Field(default_factory=list, max_length=16)
    subcommand: str = Field(default='convert', max_length=32)
    libreoffice_executable: str | None = None
    timeout_seconds: float = Field(default=600, ge=0.1, le=3600)
    ocr: bool = True
    ocr_mode: Literal['default', 'full_page'] = 'default'
    ocr_engine: Literal['auto', 'easyocr', 'rapidocr', 'tesseract'] = 'auto'
    max_output_bytes: int = Field(default=64 * 1024 * 1024, ge=100, le=512 * 1024 * 1024)


class DoclingParser:
    name = 'docling'
    version = 'external'

    def __init__(self, config: DoclingConfig | None = None):
        self.config = config or DoclingConfig()
        self._detection: tuple[bool, str, str] | None = None
        self._detected_at = 0.0

    def capabilities(self) -> list[Capability]:
        available, version, detail = self.detect()
        result = []
        for format, media_type in FORMATS.items():
            if not available:
                result.append(Capability(format=format, media_type=media_type, state='component_missing',
                                         parser=self.name, detail=detail or '未检测到 Docling 可执行文件',
                                         install_hint=INSTALL_HINT))
            elif format == 'doc' and not self._soffice():
                result.append(Capability(format=format, media_type=media_type, state='component_missing',
                                         parser=self.name, detail='已检测到 Docling，但 DOC 还需要 LibreOffice',
                                         install_hint=DOC_INSTALL_HINT))
            else:
                result.append(Capability(format=format, media_type=media_type, state='external',
                                         parser=self.name, detail=f'外部 Docling {version}'))
        return result

    def detect(self, force: bool = False) -> tuple[bool, str, str]:
        now = time.monotonic()
        if not force and self._detection is not None and now - self._detected_at < 30:
            return self._detection
        executable = self._executable()
        if not executable:
            result = (False, '', 'Docling 可执行文件未配置或不存在')
        else:
            try:
                completed = subprocess.run(
                    [executable, *self.config.prefix_args, '--version'],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    timeout=60, env=sanitized_environment(),
                    **({'creationflags': CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}),
                )
                output = (completed.stdout + completed.stderr).decode('utf-8', 'replace')[:4000]
                if completed.returncode == 0:
                    match = re.search(r'\d+\.\d+(?:\.\d+)?', output)
                    result = (True, match.group(0) if match else 'unknown', output.strip())
                else:
                    result = (False, '', f'Docling 版本检测失败（退出码 {completed.returncode}）')
            except (OSError, subprocess.TimeoutExpired) as error:
                result = (False, '', f'Docling 版本检测失败（{type(error).__name__}）')
        self._detection, self._detected_at = result, now
        return result

    def _executable(self) -> str | None:
        executable = self.config.executable.strip()
        if not executable:
            return None
        if os.sep in executable or (os.altsep and os.altsep in executable):
            return executable if Path(executable).is_file() else None
        return shutil.which(executable)

    def _soffice(self) -> str | None:
        configured = self.config.libreoffice_executable
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

    def parse(self, request: ParseRequest, cancel: Event) -> ParseResult:
        if cancel.is_set():
            raise ParseError('CANCELLED')
        available, version, detail = self.detect()
        if not available:
            raise ParseError('COMPONENT_MISSING', detail or '未检测到 Docling',
                             diagnostic={'install_hint': INSTALL_HINT})
        if request.format == 'doc' and not self._soffice():
            raise ParseError('COMPONENT_MISSING', 'DOC 需要 LibreOffice', diagnostic={'install_hint': DOC_INSTALL_HINT})
        output_dir = Path(mkdtemp(prefix='yorw-docling-'))
        try:
            self._run(self._command(request, output_dir), cancel)
            path = self._json_path(request, output_dir)
            if path.stat().st_size > self.config.max_output_bytes:
                raise ParseError('OUTPUT_TOO_LARGE')
            try:
                data = json.loads(path.read_text(encoding='utf-8'))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                raise ParseError('INVALID_OUTPUT') from None
            return self._convert(data, request, version)
        finally:
            shutil.rmtree(output_dir, ignore_errors=True)

    def _command(self, request: ParseRequest, output_dir: Path) -> list[str]:
        executable = self._executable()
        if not executable:
            raise ParseError('COMPONENT_MISSING', diagnostic={'install_hint': INSTALL_HINT})
        command = [executable, *self.config.prefix_args]
        if self.config.subcommand:
            command.append(self.config.subcommand)
        if request.format == 'pdf':
            command.append('--ocr' if self.config.ocr else '--no-ocr')
            if self.config.ocr and self.config.ocr_engine != 'auto':
                command += ['--ocr-engine', self.config.ocr_engine]
            if self.config.ocr and self.config.ocr_mode == 'full_page':
                command += ['--ocr-mode', 'full_page']
        command += ['--document-timeout', str(self.config.timeout_seconds),
                    '--to', 'json', '--output', str(output_dir), str(request.path)]
        return command

    def _run(self, command: list[str], cancel: Event) -> None:
        options = {
            'stdin': subprocess.DEVNULL, 'stdout': subprocess.PIPE, 'stderr': subprocess.PIPE,
            'env': sanitized_environment(),
        }
        if os.name == 'nt':
            options['creationflags'] = CREATE_NO_WINDOW
        else:
            options['start_new_session'] = True
        try:
            process = subprocess.Popen(command, **options)
        except OSError as error:
            raise ParseError('PARSER_FAILED', 'Docling 无法启动', diagnostic={'error': type(error).__name__}) from None
        captured: dict[str, tuple[bytes, int, bool]] = {}

        def drain(name: str, stream) -> None:
            chunks: list[bytes] = []
            total = 0
            truncated = False
            while True:
                block = stream.read(65536)
                if not block:
                    break
                total += len(block)
                if total <= self.config.max_output_bytes:
                    chunks.append(block)
                else:
                    truncated = True
            captured[name] = (b''.join(chunks), total, truncated)

        readers = [Thread(target=drain, args=('stdout', process.stdout), daemon=True),
                   Thread(target=drain, args=('stderr', process.stderr), daemon=True)]
        for thread in readers:
            thread.start()
        reason = None
        deadline = time.monotonic() + self.config.timeout_seconds
        while process.poll() is None:
            if cancel.is_set():
                reason = 'CANCELLED'
                break
            if time.monotonic() > deadline:
                reason = 'TIMEOUT'
                break
            time.sleep(0.1)
        if reason:
            self._terminate(process)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._terminate(process)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        for thread in readers:
            thread.join(timeout=2)
        stdout, _, stdout_truncated = captured.get('stdout', (b'', 0, False))
        stderr, _, stderr_truncated = captured.get('stderr', (b'', 0, False))
        if reason == 'CANCELLED':
            raise ParseError('CANCELLED')
        if reason == 'TIMEOUT':
            raise ParseError('TIMEOUT')
        if stdout_truncated or stderr_truncated:
            raise ParseError('OUTPUT_TOO_LARGE')
        if process.returncode != 0:
            tail = stderr[-2000:].decode('utf-8', 'replace')
            raise ParseError('PARSER_FAILED', 'Docling 处理失败',
                             diagnostic={'exit_code': process.returncode, 'stderr': tail})
        del stdout

    @staticmethod
    def _terminate(process: subprocess.Popen) -> None:
        if process.poll() is not None:
            return
        try:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               timeout=10, creationflags=CREATE_NO_WINDOW)
            else:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except Exception:
            pass
        try:
            process.kill()
        except Exception:
            pass

    @staticmethod
    def _json_path(request: ParseRequest, output_dir: Path) -> Path:
        expected = output_dir / f'{request.path.stem}.json'
        if expected.is_file():
            return expected
        candidates = [path for path in output_dir.rglob('*.json') if path.is_file()]
        if not candidates:
            raise ParseError('OUTPUT_MISSING')
        return max(candidates, key=lambda path: (path.stat().st_mtime, path.stat().st_size))

    def _convert(self, data: dict, request: ParseRequest, parser_version: str) -> ParseResult:
        if not isinstance(data, dict):
            raise ParseError('INVALID_OUTPUT')
        texts = data.get('texts') if isinstance(data.get('texts'), list) else []
        groups = data.get('groups') if isinstance(data.get('groups'), list) else []
        tables = data.get('tables') if isinstance(data.get('tables'), list) else []
        pictures = data.get('pictures') if isinstance(data.get('pictures'), list) else []
        lookup: dict[str, tuple[str, dict]] = {}
        for kind, items in (('text', texts), ('group', groups), ('table', tables), ('picture', pictures)):
            for index, item in enumerate(items):
                if isinstance(item, dict):
                    lookup[f'#/{kind}s/{index}' if kind != 'group' else f'#/groups/{index}'] = (kind, item)
        blocks: list[ContentBlock] = []
        warnings: list[ParseWarning] = []
        headings: list[tuple[int, str]] = []
        title: str | None = None
        visited: set[str] = set()
        total_text = 0
        truncated = False

        def page_of(item: dict) -> int | None:
            if request.format != 'pdf':
                return None
            provenance = item.get('prov')
            if isinstance(provenance, list) and provenance and isinstance(provenance[0], dict):
                number = provenance[0].get('page_no')
                if isinstance(number, int) and number >= 1:
                    return number
            return None

        def add_block(kind, text: str, item: dict, section_path: list[str], heading_level: int | None = None) -> None:
            nonlocal total_text, truncated
            text = (text or '').strip()
            if not text:
                return
            if len(blocks) >= MAX_BLOCKS:
                truncated = True
                return
            remaining = MAX_TOTAL_TEXT - total_text
            if len(text) > MAX_BLOCK_TEXT:
                text = text[:MAX_BLOCK_TEXT]
                warnings.append(ParseWarning(code='BLOCK_TEXT_TRUNCATED', block_ordinal=len(blocks),
                                             message='内容块超过单块文字上限'))
            if len(text) > remaining:
                text = text[:max(0, remaining)]
                truncated = True
                warnings.append(ParseWarning(code='TOTAL_TEXT_TRUNCATED', block_ordinal=len(blocks),
                                             message='全文字数超过上限'))
            if not text.strip():
                return
            page = page_of(item)
            ordinal = len(blocks)
            blocks.append(ContentBlock(
                id=stable_block_id(request.document_id, request.extraction_version, ordinal),
                ordinal=ordinal, type=kind, text=text, section_path=section_path,
                physical_page=page, heading_level=heading_level,
                location=SourceLocation(kind='page' if page else 'block', physical_page=page,
                                        block_ordinal=ordinal)))
            total_text += len(text)

        def add_text(item: dict) -> None:
            nonlocal title
            label = str(item.get('label') or 'text')
            text = str(item.get('text') or '')
            if label == 'title':
                if title is None and text.strip():
                    title = text.strip()[:1000]
                return
            if label in ('page_header', 'page_footer', 'marker', 'empty_value'):
                return
            if label == 'section_header':
                level = item.get('level')
                level = level if isinstance(level, int) and 1 <= level <= 6 else 1
                while headings and headings[-1][0] >= level:
                    headings.pop()
                add_block('heading', text, item, [heading for _, heading in headings], level)
                if text.strip():
                    headings.append((level, text.strip()))
                return
            mapping = {
                'paragraph': 'paragraph', 'text': 'paragraph', 'reference': 'paragraph',
                'handwritten_text': 'paragraph', 'caption': 'paragraph', 'footnote': 'paragraph',
                'list_item': 'list_item', 'code': 'code', 'formula': 'other',
                'checkbox_selected': 'paragraph', 'checkbox_unselected': 'paragraph',
            }
            add_block(mapping.get(label, 'paragraph'), text, item, [heading for _, heading in headings])

        def add_table(item: dict) -> None:
            text = self._table_text(item)
            if not text:
                warnings.append(ParseWarning(code='EMPTY_TABLE', message='表格没有可提取单元格'))
                return
            add_block('table', text, item, [heading for _, heading in headings])

        def visit(ref) -> None:
            if not isinstance(ref, dict):
                return
            key = ref.get('$ref')
            if not isinstance(key, str) or key in visited:
                return
            visited.add(key)
            kind, item = lookup.get(key, (None, None))
            if kind == 'group':
                for child in item.get('children') or []:
                    visit(child)
            elif kind == 'text':
                add_text(item)
                for child in item.get('children') or []:
                    visit(child)
            elif kind == 'table':
                add_table(item)
            elif kind == 'picture':
                warnings.append(ParseWarning(code='PICTURE_SKIPPED', message='图片未做语义理解，仅保留文字内容'))

        body = data.get('body') if isinstance(data.get('body'), dict) else {}
        children = body.get('children') if isinstance(body.get('children'), list) else []
        for ref in children:
            visit(ref)
        if not blocks and not visited:
            for item in texts:
                if isinstance(item, dict):
                    add_text(item)
            for item in tables:
                if isinstance(item, dict):
                    add_table(item)
            if pictures:
                warnings.append(ParseWarning(code='PICTURE_SKIPPED', message='图片未做语义理解，仅保留文字内容'))
        page_count = None
        if request.format == 'pdf':
            numbers = [block.physical_page for block in blocks if block.physical_page]
            pages = data.get('pages')
            if isinstance(pages, dict):
                for key in pages:
                    try:
                        number = int(key)
                    except (TypeError, ValueError):
                        continue
                    if number >= 1:
                        numbers.append(number)
            page_count = max(numbers) if numbers else None
        metadata = ParseMetadata(authors=[])
        if title:
            metadata = ParseMetadata(title=title, authors=[])
        elif isinstance(data.get('name'), str) and data['name'].strip():
            metadata = ParseMetadata(title=data['name'].strip()[:1000], authors=[])
        if not blocks:
            status, warning = 'unsupported', ('NO_TEXT_NO_OCR' if request.format == 'pdf' else 'NO_TEXT')
        elif warnings or truncated:
            status, warning = 'partial', 'PARTIAL_TEXT'
        else:
            status, warning = 'ready', None
        fingerprint = config_fingerprint({
            'parser': self.name, 'version': parser_version, 'ocr': self.config.ocr,
            'ocr_mode': self.config.ocr_mode, 'timeout_seconds': self.config.timeout_seconds,
            'max_output_bytes': self.config.max_output_bytes, 'subcommand': self.config.subcommand,
            'ocr_engine': self.config.ocr_engine,
            'executable': Path(self.config.executable).name if self.config.executable else '',
        })
        summary = f'{len(blocks)} 个内容块' + (f' / {page_count} 页' if page_count else '')
        return ParseResult(format=request.format, media_type=FORMATS.get(request.format, 'application/octet-stream'),
                           parser_name=self.name, parser_version=parser_version or 'unknown',
                           config_fingerprint=fingerprint, status=status, warning=warning, summary=summary,
                           metadata=metadata, page_count=page_count, blocks=blocks, warnings=warnings)

    @staticmethod
    def _table_text(item: dict) -> str:
        data = item.get('data') if isinstance(item.get('data'), dict) else {}
        cells = data.get('table_cells') if isinstance(data.get('table_cells'), list) else []
        rows: dict[int, dict[int, str]] = {}
        for cell in cells:
            if not isinstance(cell, dict):
                continue
            try:
                row = int(cell.get('start_row_offset_idx', 0))
                column = int(cell.get('start_col_offset_idx', 0))
            except (TypeError, ValueError):
                continue
            rows.setdefault(row, {})[column] = str(cell.get('text') or '').strip()
        lines = [' | '.join(values[column] for column in sorted(values)) for _, values in sorted(rows.items())]
        return '\n'.join(line for line in lines if line.strip())
