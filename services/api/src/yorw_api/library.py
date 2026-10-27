"""Managed PDF ingestion and cancellable page extraction. No OCR or retrieval."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
import json
import logging
from threading import Lock, Event
from uuid import uuid4, UUID

from pypdf import PdfReader
from pypdf.errors import DependencyError, FileNotDecryptedError
from fastapi import APIRouter, UploadFile, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ConfigDict
from .storage.database import Database

MAX_BYTES = 50 * 1024 * 1024
MAX_PAGES = 2000
MAX_PAGE_TEXT = 200_000
MAX_TAGS = 50
MAX_TAG_LENGTH = 40
MAX_SUMMARY_LENGTH = 20_000
logging.getLogger("pypdf").setLevel(logging.CRITICAL)


def normalize_tags(values: list[str]) -> list[str]:
    """Trim, drop blanks and deduplicate case-insensitively while keeping first spelling."""
    tags, seen = [], set()
    for value in values:
        tag = value.strip()
        if not tag:
            continue
        if len(tag) > MAX_TAG_LENGTH:
            raise HTTPException(422, detail="INVALID_METADATA")
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        tags.append(tag)
    if len(tags) > MAX_TAGS:
        raise HTTPException(422, detail="INVALID_METADATA")
    return tags


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Metadata(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    version: int = Field(ge=1)
    title: str | None = Field(default=None, max_length=1000)
    authors: list[str] = Field(default_factory=list, max_length=100)
    year: int | None = Field(default=None, ge=1000, le=9999)
    # None preserves the saved value; [] / "" clears it. This keeps older callers
    # from erasing metadata they never sent.
    tags: list[str] | None = Field(default=None, max_length=200)
    summary_md: str | None = Field(default=None, max_length=MAX_SUMMARY_LENGTH)


class ReadingPosition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(ge=1, strict=True)


class Library:
    def __init__(self, database: Database):
        self.db = database
        self.workspace = database.workspace
        self.operations = Lock()
        self.closing = Event()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pdf-extract")
        with self.db.write() as conn:
            conn.execute("UPDATE tasks SET status='interrupted',stage='INTERRUPTED',updated_at=? WHERE status IN ('running','queued')", (now(),))
            conn.execute("UPDATE documents SET extraction_status='failed',warning='INTERRUPTED' WHERE extraction_status IN ('pending','running')")
        self.reconcile()

    def rows(self, sql, values=()):
        with self.db.lock:
            cursor = self.db.connection.execute(sql, values)
            names = [item[0] for item in cursor.description]
            return [dict(zip(names, row)) for row in cursor.fetchall()]

    def document(self, identity: str, deleted=False):
        rows = self.rows("SELECT * FROM documents WHERE id=?" + ("" if deleted else " AND deleted_at IS NULL"), (identity,))
        if not rows:
            raise HTTPException(404, detail="DOCUMENT_NOT_FOUND")
        result = rows[0]
        for field in ("authors", "metadata_source"):
            result[field] = json.loads(result.pop(field + "_json"))
        result["tags"] = [item["tag"] for item in self.rows(
            "SELECT tag FROM document_tags WHERE document_id=? ORDER BY created_at,tag_key", (identity,))]
        result.pop("relative_path")
        latest = self.rows("SELECT id FROM tasks WHERE target_id=? AND kind='extract' ORDER BY created_at DESC LIMIT 1", (identity,))
        result['task'] = self.task(latest[0]['id']) if latest else None
        return result

    def task(self, identity: str):
        rows = self.rows("SELECT * FROM tasks WHERE id=?", (identity,))
        if not rows:
            raise HTTPException(404, detail="TASK_NOT_FOUND")
        result = rows[0]
        for field in ("input", "result", "error"):
            result[field] = json.loads(result.pop(field + "_json") or "null")
        return result

    def list(self):
        with self.db.lock:
            return [self.document(item['id']) for item in self.rows("SELECT id FROM documents WHERE deleted_at IS NULL ORDER BY created_at DESC")]

    def reconcile(self):
        # Only clean an orphan backed by our durable import receipt and matching digest.
        for receipt in (self.workspace.root / "tmp").glob("import-*.json"):
            try:
                data = json.loads(receipt.read_text(encoding="utf-8"))
                identity = str(UUID(data['document_id']))
                if receipt.name != f"import-{identity}.json":
                    continue
                path = self.workspace.document_path(identity)
                exists = self.rows("SELECT id FROM documents WHERE id=?", (identity,))
                if exists:
                    receipt.unlink()
                elif path.exists() and sha256(path.read_bytes()).hexdigest() == data['sha256']:
                    self.workspace.remove_document(identity)
                    receipt.unlink()
                elif not path.exists():
                    receipt.unlink()
            except (ValueError, KeyError, OSError):
                continue
        for row in self.rows("SELECT id FROM documents WHERE deleted_at IS NOT NULL AND relative_path IS NOT NULL"):
            self.cleanup_deleted(row['id'])

    def cleanup_deleted(self, identity):
        try:
            self.workspace.remove_document(identity)
            with self.db.write() as conn:
                conn.execute("UPDATE documents SET relative_path=NULL,warning=NULL WHERE id=? AND deleted_at IS NOT NULL", (identity,))
            return True
        except OSError:
            return False

    def import_pdf(self, source, original_name):
        source.seek(0, 2)
        size = source.tell()
        source.seek(0)
        if size > MAX_BYTES:
            raise HTTPException(413, detail="PDF_TOO_LARGE")
        if not source.read(1024).lstrip().startswith(b"%PDF-"):
            raise HTTPException(422, detail="NOT_PDF")
        source.seek(0)
        digest = sha256()
        while block := source.read(1024 * 1024):
            digest.update(block)
        source.seek(0)
        digest = digest.hexdigest()
        with self.operations:
            existing = self.rows("SELECT id,deleted_at,extraction_version,version FROM documents WHERE sha256=?", (digest,))
            if existing and not existing[0]['deleted_at'] and self.workspace.document_path(existing[0]['id']).exists():
                doc = self.document(existing[0]['id'])
                tasks = self.rows("SELECT id FROM tasks WHERE target_id=? AND kind='extract' ORDER BY created_at DESC LIMIT 1", (doc['id'],))
                return {"document": doc, "task": self.task(tasks[0]['id']) if tasks else None, "deduplicated": True}
            identity = existing[0]['id'] if existing else str(uuid4())
            if existing and not self.cleanup_deleted(identity):
                raise HTTPException(409, detail="FILE_CLEANUP_PENDING")
            receipt = self.workspace.root / "tmp" / f"import-{identity}.json"
            with receipt.open('w', encoding='utf-8') as output:
                import os
                json.dump({"document_id": identity, "sha256": digest}, output)
                output.flush()
                os.fsync(output.fileno())
            try:
                self.workspace.store_document(source, identity)
                timestamp = now()
                task_id = str(uuid4())
                with self.db.write() as conn:
                    if existing:
                        conn.execute("UPDATE documents SET relative_path=?,deleted_at=NULL,extraction_status='pending',extraction_version=extraction_version+1,version=version+1,warning=NULL,updated_at=? WHERE id=?", (f"documents/{identity}.pdf",timestamp,identity))
                    else:
                        name = (original_name or 'document.pdf').replace('\\','/').split('/')[-1][:255]
                        conn.execute("INSERT INTO documents(id,sha256,relative_path,original_name,extraction_status,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?)", (identity,digest,f"documents/{identity}.pdf",name,timestamp,timestamp))
                    conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,created_at,updated_at) VALUES(?,'extract',?,'queued','QUEUED',?,?)", (task_id,identity,timestamp,timestamp))
                receipt.unlink(missing_ok=True)
            except Exception:
                # Reconciliation will only remove files with an owned receipt, never arbitrary files.
                self.reconcile()
                raise
            self.pool.submit(self.extract, identity, task_id)
            return {"document": self.document(identity), "task": self.task(task_id), "deduplicated": False}

    def active(self, identity, task_id):
        if self.closing.is_set():
            return False
        return bool(self.rows("SELECT t.id FROM tasks t JOIN documents d ON d.id=t.target_id WHERE t.id=? AND d.id=? AND d.deleted_at IS NULL AND t.status IN ('queued','running')", (task_id,identity)))

    def extract(self, identity, task_id):
        try:
            with self.db.write() as conn:
                if not self.active(identity, task_id):
                    return
                conn.execute("UPDATE tasks SET status='running',stage='EXTRACTING',updated_at=? WHERE id=?", (now(),task_id))
                conn.execute("UPDATE documents SET extraction_status='running' WHERE id=?", (identity,))
            texts, failures, warning, status = [], 0, None, 'ready'
            total_text = 0
            metadata, pages = {}, None
            with self.workspace.document_path(identity).open('rb') as stream:
                reader = PdfReader(stream)
                if reader.is_encrypted:
                    status, warning = 'unsupported', 'ENCRYPTED_PDF'
                else:
                    pages = len(reader.pages)
                    if pages > MAX_PAGES:
                        status, warning = 'unsupported', 'PAGE_LIMIT'
                    else:
                        try:
                            info = reader.metadata
                            metadata = {"title": str(info.title)[:1000] if info and info.title else None, "authors": [str(info.author)[:1000]] if info and info.author else []}
                        except Exception:
                            metadata = {}
                        for number, page in enumerate(reader.pages, 1):
                            if not self.active(identity, task_id):
                                return
                            try:
                                text = page.extract_text() or ''
                                if len(text) > MAX_PAGE_TEXT:
                                    text = text[:MAX_PAGE_TEXT]
                                    failures += 1
                                remaining = max(0, 10_000_000 - total_text)
                                if len(text) > remaining:
                                    text = text[:remaining]
                                    failures += 1
                                if text.strip():
                                    texts.append((number, text))
                                    total_text += len(text)
                            except Exception:
                                failures += 1
                            if total_text >= 10_000_000:
                                failures += 1
                                break
                            with self.db.write() as conn:
                                conn.execute("UPDATE tasks SET progress=?,updated_at=? WHERE id=? AND status='running'", (number / max(pages,1),now(),task_id))
                        if not texts:
                            status, warning = ('failed', 'EXTRACTION_FAILED') if failures else ('unsupported', 'NO_TEXT_NO_OCR')
                        elif failures or len(texts) < pages:
                            status, warning = 'partial', 'PARTIAL_TEXT'
            self.finish(identity, task_id, status, warning, pages, texts, metadata)
        except (DependencyError, FileNotDecryptedError):
            self.finish(identity, task_id, 'unsupported', 'ENCRYPTED_PDF', None, [], {})
        except Exception:
            self.finish(identity, task_id, 'failed', 'PDF_PARSE_FAILED', None, [], {})

    def finish(self, identity, task_id, status, warning, pages, texts, metadata):
        with self.db.write() as conn:
            if not self.active(identity, task_id):
                return
            doc = self.document(identity)
            conn.execute("DELETE FROM chunks WHERE document_id=?", (identity,))
            conn.execute('DELETE FROM index_generations WHERE document_id=?', (identity,))
            conn.execute('DELETE FROM search_documents WHERE document_id=?', (identity,))
            conn.execute('UPDATE documents SET active_index_generation=NULL WHERE id=?', (identity,))
            for ordinal, (page, text) in enumerate(texts):
                conn.execute("INSERT INTO chunks VALUES(?,?,?,?,?,?)", (str(uuid4()),identity,doc['extraction_version'],ordinal,page,text))
            sources = doc['metadata_source']
            title, authors = doc['title'], doc['authors']
            if sources.get('title') != 'user' and metadata.get('title'):
                title, sources['title'] = metadata['title'], 'pdf'
            if sources.get('authors') != 'user' and metadata.get('authors'):
                authors, sources['authors'] = metadata['authors'], 'pdf'
            conn.execute("UPDATE documents SET title=?,authors_json=?,metadata_source_json=?,page_count=?,extraction_status=?,warning=?,updated_at=? WHERE id=?", (title,json.dumps(authors),json.dumps(sources),pages,status,warning,now(),identity))
            task_status = 'failed' if status == 'failed' else 'succeeded'
            conn.execute("UPDATE tasks SET status=?,stage=?,progress=1,result_json=?,error_json=?,updated_at=? WHERE id=?", (task_status,warning or 'COMPLETED',json.dumps({'document_id': identity, 'extraction_status': status}),json.dumps({'code': warning}) if warning else None,now(),task_id))

    def update(self, identity, metadata: Metadata):
        tags = normalize_tags(metadata.tags) if metadata.tags is not None else None
        with self.operations, self.db.write() as conn:
            doc = self.document(identity)
            if doc['version'] != metadata.version:
                raise HTTPException(409, detail="DOCUMENT_CONFLICT")
            if any(len(author) > 1000 for author in metadata.authors):
                raise HTTPException(422, detail="INVALID_METADATA")
            timestamp = now()
            summary_md, summary_source, summary_updated_at = (
                doc['summary_md'], doc['summary_source'], doc['summary_updated_at'])
            summary_changed = False
            if metadata.summary_md is not None:
                candidate = metadata.summary_md.strip()
                if not candidate:
                    summary_changed = summary_md is not None or summary_source is not None
                    summary_md = summary_source = summary_updated_at = None
                elif candidate != (summary_md or ''):
                    summary_changed = True
                    summary_md, summary_source, summary_updated_at = candidate, 'manual', timestamp
            sources = {**doc['metadata_source'], 'title': 'user', 'authors': 'user', 'year': 'user'}
            if tags is not None:
                sources['tags'] = 'user'
            if summary_changed:
                sources['summary'] = 'user'
            conn.execute(
                "UPDATE documents SET title=?,authors_json=?,year=?,metadata_source_json=?,summary_md=?,summary_source=?,summary_updated_at=?,version=version+1,updated_at=? WHERE id=?",
                (metadata.title or None, json.dumps(metadata.authors), metadata.year, json.dumps(sources),
                 summary_md, summary_source, summary_updated_at, timestamp, identity))
            if tags is not None:
                conn.execute("DELETE FROM document_tags WHERE document_id=?", (identity,))
                conn.executemany(
                    "INSERT INTO document_tags(document_id,tag_key,tag,created_at) VALUES(?,?,?,?)",
                    [(identity, tag.casefold(), tag, timestamp) for tag in tags])
        return self.document(identity)

    def remove(self, identity, version):
        with self.operations:
            with self.db.write() as conn:
                doc = self.document(identity)
                if doc['version'] != version:
                    raise HTTPException(409, detail="DOCUMENT_CONFLICT")
                timestamp = now()
                conn.execute("UPDATE documents SET deleted_at=?,updated_at=?,version=version+1,active_index_generation=NULL,warning='FILE_CLEANUP_PENDING' WHERE id=?", (timestamp,timestamp,identity))
                conn.execute("DELETE FROM chunks WHERE document_id=?", (identity,))
                conn.execute('DELETE FROM index_generations WHERE document_id=?', (identity,))
                conn.execute('DELETE FROM search_documents WHERE document_id=?', (identity,))
                conn.execute("UPDATE search_history SET status='cancelled',error_code='DOCUMENT_REMOVED',updated_at=? WHERE task_id IN (SELECT id FROM tasks WHERE target_id=? AND status IN ('queued','running'))", (timestamp,identity))
                conn.execute("UPDATE tasks SET status='cancelled',stage='DOCUMENT_REMOVED',updated_at=? WHERE target_id=? AND status IN ('queued','running')", (timestamp,identity))
            return {"removed": True, "cleanup_pending": not self.cleanup_deleted(identity)}

    def retry(self, task_id):
        with self.operations, self.db.write() as conn:
            task = self.task(task_id)
            if task['kind'] != 'extract':
                raise HTTPException(409, detail='INVALID_INPUT')
            identity = task['target_id']
            self.document(identity)
            if self.rows("SELECT id FROM tasks WHERE target_id=? AND status IN ('queued','running')", (identity,)):
                raise HTTPException(409, detail="TASK_RUNNING")
            identity_task = str(uuid4())
            conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,created_at,updated_at) VALUES(?,'extract',?,'queued','QUEUED',?,?)", (identity_task,identity,now(),now()))
            conn.execute("UPDATE documents SET extraction_status='pending',extraction_version=extraction_version+1,warning=NULL WHERE id=?", (identity,))
        self.pool.submit(self.extract, identity, identity_task)
        return self.task(identity_task)

    def file(self, identity: str):
        self.document(identity)
        try:
            path = self.workspace.document_path(identity)
            if not path.is_file():
                raise HTTPException(404, detail="DOCUMENT_FILE_MISSING")
            return path
        except (ValueError, OSError):
            raise HTTPException(404, detail="DOCUMENT_FILE_MISSING") from None

    def save_position(self, identity: str, page: int):
        with self.operations, self.db.write() as conn:
            document = self.document(identity)
            count = document['page_count']
            if not count:
                raise HTTPException(409, detail="PAGE_COUNT_UNAVAILABLE")
            if type(page) is not int or page < 1 or page > count:
                raise HTTPException(422, detail="INVALID_PAGE")
            conn.execute("UPDATE documents SET last_page=?,updated_at=? WHERE id=?", (page,now(),identity))
        return {"page": page}

    def cancel(self, task_id):
        with self.operations, self.db.write() as conn:
            task = self.task(task_id)
            if task['kind'] != 'extract':
                raise HTTPException(409, detail='INVALID_INPUT')
            if task['status'] in ('queued', 'running'):
                conn.execute("UPDATE tasks SET status='cancelled',stage='CANCELLED',updated_at=? WHERE id=?", (now(),task_id))
                conn.execute("UPDATE documents SET extraction_status='failed',warning='CANCELLED' WHERE id=? AND deleted_at IS NULL", (task['target_id'],))
        return self.task(task_id)

    def close(self):
        self.closing.set()
        self.pool.shutdown(wait=True, cancel_futures=True)


def router(library: Library):
    routes = APIRouter()
    @routes.post('/v1/documents/import')
    def import_pdf(file: UploadFile):
        try:
            return library.import_pdf(file.file, file.filename)
        finally:
            file.file.close()
    @routes.get('/v1/documents')
    def list_documents():
        return {'items': library.list()}
    @routes.get('/v1/documents/{identity}')
    def document(identity: str):
        return library.document(identity)
    @routes.get('/v1/documents/{identity}/file')
    def file(identity: str):
        return FileResponse(library.file(identity), media_type='application/pdf')
    @routes.patch('/v1/documents/{identity}/position')
    def position(identity: str, position: ReadingPosition):
        return library.save_position(identity, position.page)
    @routes.patch('/v1/documents/{identity}')
    def update(identity: str, metadata: Metadata):
        return library.update(identity, metadata)
    @routes.delete('/v1/documents/{identity}')
    def remove(identity: str, version: int):
        return library.remove(identity, version)
    @routes.get('/v1/tasks/{identity}')
    def task(identity: str):
        return library.task(identity)
    @routes.post('/v1/tasks/{identity}/cancel')
    def cancel(identity: str):
        return library.cancel(identity)
    @routes.post('/v1/tasks/{identity}/retry')
    def retry(identity: str):
        return library.retry(identity)
    return routes
