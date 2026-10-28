"""Bounded local subprocess execution for user-installed parsers and converters."""
from __future__ import annotations

import os
import signal
import subprocess
from threading import Event, Thread
import time

from .base import ParseError

CREATE_NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
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


def terminate_tree(process: subprocess.Popen) -> None:
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


def run_bounded(command: list[str], timeout: float, cancel: Event | None,
                max_output_bytes: int) -> tuple[int, bytes, bytes]:
    """Run without a shell, bound output and time, and kill the tree on cancel."""
    if cancel is not None and cancel.is_set():
        raise ParseError('CANCELLED')
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
        raise ParseError('PARSER_FAILED', '外部程序无法启动', diagnostic={'error': type(error).__name__}) from None
    captured: dict[str, tuple[bytes, bool]] = {}

    def drain(name: str, stream) -> None:
        chunks: list[bytes] = []
        total = 0
        truncated = False
        while True:
            block = stream.read(65536)
            if not block:
                break
            total += len(block)
            if total <= max_output_bytes:
                chunks.append(block)
            else:
                truncated = True
        captured[name] = (b''.join(chunks), truncated)

    readers = [Thread(target=drain, args=('stdout', process.stdout), daemon=True),
               Thread(target=drain, args=('stderr', process.stderr), daemon=True)]
    for thread in readers:
        thread.start()
    reason = None
    deadline = time.monotonic() + timeout
    while process.poll() is None:
        if cancel is not None and cancel.is_set():
            reason = 'CANCELLED'
            break
        if time.monotonic() > deadline:
            reason = 'TIMEOUT'
            break
        time.sleep(0.1)
    if reason:
        terminate_tree(process)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        terminate_tree(process)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
    for thread in readers:
        thread.join(timeout=2)
    stdout, stdout_truncated = captured.get('stdout', (b'', False))
    stderr, stderr_truncated = captured.get('stderr', (b'', False))
    if reason == 'CANCELLED':
        raise ParseError('CANCELLED')
    if reason == 'TIMEOUT':
        raise ParseError('TIMEOUT')
    if stdout_truncated or stderr_truncated:
        raise ParseError('OUTPUT_TOO_LARGE')
    return process.returncode, stdout, stderr
