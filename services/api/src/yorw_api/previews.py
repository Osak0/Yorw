"""Rebuildable original-file previews. Never used as authoritative RAG text."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
from threading import Event, RLock
from typing import Protocol
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pypdf import PdfReader

from .library import now
from .parsing import ParseError
from .parsing.doc import find_soffice
from .parsing.process import run_bounded
from .parsing.text import decode_text

MAX_PREVIEW_BYTES = 50 * 1024 * 1024


def normalized(text):
    """Return matching characters and their original offsets, including across pages."""
    chars, offsets = [], []
    for match in re.finditer(r'-\s*\n|\s+|.', text, re.DOTALL):
        if match.group().isspace() or re.fullmatch(r'-\s*\n', match.group()):
            continue
        for char in match.group():
            chars.append(char)
            offsets.append(match.start())
    return ''.join(chars), offsets


def locate_blocks(blocks, pages):
    """Exact normalized matching only. Ambiguous repeated evidence stays unmapped."""
    joined = '\n'.join(pages)
    text, offsets = normalized(joined)
    # Repeated page-margin lines are layout artifacts, not intervening evidence.
    margins = {}
    page_lines = []
    for page in pages:
        lines = list(re.finditer(r'[^\n]+', page))
        candidates = lines[:2] + lines[-2:]
        page_lines.append(candidates)
        for value in {line.group().strip() for line in candidates}:
            margins[value] = margins.get(value, 0) + 1
    excluded = []
    page_start = 0
    for page, lines in zip(pages, page_lines):
        for line in lines:
            if margins.get(line.group().strip(), 0) > 1:
                excluded.append((page_start + line.start(), page_start + line.end()))
        page_start += len(page) + 1
    excluded.sort()
    kept_chars, kept_offsets, interval = [], [], 0
    for char, offset in zip(text, offsets):
        while interval < len(excluded) and excluded[interval][1] <= offset:
            interval += 1
        if interval == len(excluded) or offset < excluded[interval][0]:
            kept_chars.append(char)
            kept_offsets.append(offset)
    text = ''.join(kept_chars)
    offsets = kept_offsets
    boundaries, total = [], 0
    for page in pages:
        boundaries.append((total, total + len(page)))
        total += len(page) + 1
    result = {}
    for block in blocks:
        evidence = block['text']
        if block.get('block_type') == 'table':
            evidence = '\n'.join(line.replace('|', ' ') for line in evidence.splitlines() if not re.fullmatch(r'[\s|:\-]+', line))
        needle, _ = normalized(evidence)
        if not needle:
            continue
        first = text.find(needle)
        if first < 0 or text.find(needle, first + 1) >= 0:
            continue
        matched_offsets = offsets[first:first + len(needle)]
        ranges = []
        for index, (left, right) in enumerate(boundaries):
            page_offsets = [offset for offset in matched_offsets if left <= offset < right]
            if page_offsets:
                a, b = min(page_offsets), max(page_offsets) + 1
                ranges.append({'page': index + 1, 'start': a - left, 'end': b - left,
                               'quote': joined[a:b]})
        result[block['id']] = ranges
    return result


class DocumentPreviewProvider(Protocol):
    def start(self, identity: str) -> dict: ...
    def status(self, identity: str, preview_id: str) -> dict: ...
    def cancel(self, identity: str, preview_id: str) -> dict: ...


class Previews:
    def __init__(self, library, settings):
        self.library, self.db, self.settings = library, library.db, settings
        self.root = self.library.workspace.root / 'previews'
        self.root.mkdir(exist_ok=True)
        if self.root.is_symlink() or self.root.resolve() != self.root:
            raise ValueError('Unsafe preview directory')
        self.lock = RLock()
        self.events = {}
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='preview')
        with self.db.write() as conn:
            conn.execute("UPDATE document_previews SET status='failed',error='INTERRUPTED' WHERE status='running'")

    def close(self):
        for event in list(self.events.values()):
            event.set()
        self.pool.shutdown(wait=True, cancel_futures=True)

    def path(self, preview_id):
        if not re.fullmatch(r'[a-f0-9-]{36}', preview_id):
            raise HTTPException(422, detail='INVALID_INPUT')
        path = self.root / (preview_id + '.pdf')
        if path.is_symlink() or path.resolve().parent != self.root:
            raise HTTPException(422, detail='INVALID_INPUT')
        return path

    def status(self, identity, preview_id):
        self.library.document(identity)
        rows = self.library.rows('SELECT id,status,error FROM document_previews WHERE id=? AND document_id=?', (preview_id, identity))
        if not rows:
            raise HTTPException(404, detail='PREVIEW_NOT_FOUND')
        return rows[0]

    def start(self, identity):
        doc = self.library.document(identity)
        if doc['format'] not in ('doc','docx'):
            raise HTTPException(422, detail='UNSUPPORTED_FORMAT')
        if not self.settings.approved:
            raise HTTPException(409, detail='COMPONENT_APPROVAL_REQUIRED')
        config = self.settings.docling_config()
        executable = find_soffice(config.libreoffice_executable)
        if not executable:
            raise HTTPException(409, detail='COMPONENT_MISSING')
        # On Windows soffice.exe --version can wait for a GUI instance. Fingerprint
        # the installed converter binaries/version file without launching a probe.
        converter = Path(executable)
        fingerprints = [(str(converter), sha256(converter.read_bytes()).hexdigest())]
        for name in ('soffice.bin', 'version.ini'):
            component = converter.parent / name
            if component.is_file():
                fingerprints.append((name, sha256(component.read_bytes()).hexdigest()))
        key = sha256(json.dumps([doc['sha256'], fingerprints, 'writer-pdf-v1']).encode()).hexdigest()
        with self.lock, self.db.write() as conn:
            row = conn.execute('SELECT id,status FROM document_previews WHERE document_id=? AND cache_key=?', (identity,key)).fetchone()
            if row and (row[1] == 'running' or row[1] == 'ready' and self.path(row[0]).is_file()):
                return self.status(identity,row[0])
            preview_id = row[0] if row else str(uuid4())
            conn.execute("INSERT INTO document_previews(id,document_id,cache_key,status,created_at) VALUES(?,?,?,'running',?) ON CONFLICT(document_id,cache_key) DO UPDATE SET status='running',error=NULL",(preview_id,identity,key,now()))
            event = Event()
            self.events[preview_id] = event
            self.pool.submit(self.generate, identity, preview_id, doc['format'], executable, config.timeout_seconds, event)
        return self.status(identity,preview_id)

    def generate(self, identity, preview_id, format, executable, timeout, event):
        try:
            with TemporaryDirectory(prefix='yorw-preview-', dir=self.library.workspace.root / 'tmp') as folder:
                folder = Path(folder)
                source = self.library.workspace.document_path(identity, format)
                command = [executable, '--headless', '--safe-mode', '--norestore', '--nolockcheck',
                           '-env:UserInstallation=' + (folder / 'profile').as_uri(), '--convert-to',
                           'pdf:writer_pdf_Export', '--outdir', str(folder), str(source)]
                code, _, _ = run_bounded(command, timeout, event, MAX_PREVIEW_BYTES)
                generated = folder / (source.stem + '.pdf')
                if code or not generated.is_file():
                    raise ParseError('PREVIEW_FAILED')
                if generated.stat().st_size > MAX_PREVIEW_BYTES:
                    raise ParseError('OUTPUT_TOO_LARGE')
                reader = PdfReader(generated)
                if len(reader.pages) > 2000:
                    raise ParseError('PAGE_LIMIT')
                pages = [page.extract_text() or '' for page in reader.pages]
                if sum(map(len,pages)) > 10_000_000:
                    raise ParseError('OUTPUT_TOO_LARGE')
                with self.lock, self.db.write() as conn:
                    if event.is_set() or not self.library.rows('SELECT id FROM documents WHERE id=? AND deleted_at IS NULL',(identity,)):
                        raise ParseError('CANCELLED')
                    generated.replace(self.path(preview_id))
                    conn.execute("UPDATE document_previews SET status='ready',pages_json=?,error=NULL WHERE id=?",(json.dumps(pages),preview_id))
        except Exception as error:
            with self.db.write() as conn:
                conn.execute("UPDATE document_previews SET status=?,error=? WHERE id=?",('cancelled' if event.is_set() else 'failed',getattr(error,'code','PREVIEW_FAILED'),preview_id))
        finally:
            self.events.pop(preview_id,None)

    def cancel(self, identity, preview_id):
        self.status(identity,preview_id)
        with self.lock:
            event = self.events.get(preview_id)
            if event:
                event.set()
        return self.status(identity,preview_id)

    def location(self, identity, preview_id, block_id):
        if self.status(identity,preview_id)['status'] != 'ready':
            raise HTTPException(409, detail='PREVIEW_NOT_READY')
        blocks = self.library.rows('SELECT id,text,block_type,extraction_version FROM document_blocks WHERE document_id=? AND id=?',(identity,block_id))
        if not blocks:
            return {'matched':False,'ranges':[], 'reason':'SOURCE_VERSION_UNAVAILABLE'}
        cached = self.library.rows('SELECT ranges_json FROM preview_locations WHERE preview_id=? AND block_id=? AND extraction_version=?', (preview_id,block_id,blocks[0]['extraction_version']))
        if cached:
            value = json.loads(cached[0]['ranges_json'])
            if isinstance(value, dict) and value.get('mapping_version') == 2:
                ranges = value['ranges']
                return {'matched':bool(ranges),'ranges':ranges,'extraction_version':blocks[0]['extraction_version'],'evidence':blocks[0]['text']}
        row = self.library.rows('SELECT pages_json FROM document_previews WHERE id=?',(preview_id,))[0]
        ranges = locate_blocks(blocks,json.loads(row['pages_json'])).get(block_id,[])
        with self.db.write() as conn:
            conn.execute('INSERT OR REPLACE INTO preview_locations VALUES(?,?,?,?)',(preview_id,block_id,blocks[0]['extraction_version'],json.dumps({'mapping_version':2,'ranges':ranges})))
        return {'matched':bool(ranges),'ranges':ranges,'extraction_version':blocks[0]['extraction_version'],'evidence':blocks[0]['text']}

    def remove(self, identity):
        with self.lock, self.db.write() as conn:
            for row in self.library.rows('SELECT id FROM document_previews WHERE document_id=?',(identity,)):
                if row['id'] in self.events:
                    self.events[row['id']].set()
                self.path(row['id']).unlink(missing_ok=True)
            conn.execute('DELETE FROM document_previews WHERE document_id=?',(identity,))


def router(previews):
    routes = APIRouter()
    @routes.post('/v1/documents/{identity}/preview')
    def start(identity:str):
        return previews.start(identity)
    @routes.get('/v1/documents/{identity}/preview/{preview_id}')
    def status(identity:str,preview_id:str):
        return previews.status(identity,preview_id)
    @routes.post('/v1/documents/{identity}/preview/{preview_id}/cancel')
    def cancel(identity:str,preview_id:str):
        return previews.cancel(identity,preview_id)
    @routes.get('/v1/documents/{identity}/preview/{preview_id}/location/{block_id}')
    def location(identity:str,preview_id:str,block_id:str):
        return previews.location(identity,preview_id,block_id)
    @routes.get('/v1/documents/{identity}/preview/{preview_id}/file')
    def file(identity:str,preview_id:str):
        if previews.status(identity,preview_id)['status'] != 'ready':
            raise HTTPException(409,detail='PREVIEW_NOT_READY')
        return FileResponse(previews.path(preview_id), media_type='application/pdf')
    @routes.get('/v1/documents/{identity}/original-view')
    def original(identity:str):
        from .original_view import original_docx
        doc = previews.library.document(identity)
        if doc['format'] == 'docx':
            try:
                return original_docx(previews.library.file(identity))
            except ParseError as error:
                raise HTTPException(422, detail=error.code) from None
        if doc['format'] == 'doc':
            return {'kind':'unavailable','notice':'旧 DOC 格式的应用内预览需要可选 LibreOffice；可另存为 DOCX 后使用内置预览。'}
        raise HTTPException(422, detail='UNSUPPORTED_FORMAT')

    @routes.get('/v1/documents/{identity}/original-text')
    def text(identity:str):
        doc=previews.library.document(identity)
        if doc['format'] not in ('md','txt'):
            raise HTTPException(422,detail='UNSUPPORTED_FORMAT')
        body, encoding, _ = decode_text(previews.library.file(identity).read_bytes())
        return {'text':body,'encoding':encoding}
    return routes
