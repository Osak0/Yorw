"""Managed multi-format ingestion and cancellable parser tasks. No OCR by default."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
import json
import logging
from pathlib import Path
from threading import Lock, Event, Thread
from uuid import uuid4, UUID

from fastapi import APIRouter, UploadFile, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ConfigDict
from .storage.database import Database
from .parsing import ParseError, ParseRequest, ParseResult, default_registry

MAX_BYTES = 50 * 1024 * 1024
MAX_TAGS = 50
MAX_TAG_LENGTH = 40
MAX_SUMMARY_LENGTH = 20_000
FORMAT_MEDIA = {
    'pdf': 'application/pdf',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
    'md': 'text/markdown',
    'txt': 'text/plain',
}
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
    # None preserves the saved value; [] / "" clears it. Omitted title, authors
    # and year also preserve their values and provenance for partial clients.
    tags: list[str] | None = Field(default=None, max_length=200)
    summary_md: str | None = Field(default=None, max_length=MAX_SUMMARY_LENGTH)


class ReadingPosition(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(ge=1, strict=True)


class Library:
    def __init__(self, database: Database, parsers=None, parser_service=None):
        self.db = database
        self.workspace = database.workspace
        self.parsers = parsers or default_registry()
        self.parser_service = parser_service
        self.operations = Lock()
        self.closing = Event()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pdf-extract")
        with self.db.write() as conn:
            conn.execute("UPDATE tasks SET status='interrupted',stage='INTERRUPTED',updated_at=? WHERE status IN ('running','queued')", (now(),))
            conn.execute("UPDATE documents SET extraction_status='failed',warning='INTERRUPTED' WHERE extraction_status IN ('pending','running')")
            conn.execute("UPDATE documents SET parse_status='failed',parse_warning='INTERRUPTED' WHERE parse_status IN ('pending','running')")
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
        for field in ("parser_config", "parse_warnings"):
            raw = result.pop(field + "_json", None)
            result[field] = json.loads(raw) if raw else ({} if field == "parser_config" else [])
        result["tags"] = [item["tag"] for item in self.rows(
            "SELECT tag FROM document_tags WHERE document_id=? ORDER BY created_at,tag_key", (identity,))]
        result.pop("relative_path")
        latest = self.rows("SELECT id FROM tasks WHERE target_id=? AND kind='extract' ORDER BY created_at DESC LIMIT 1", (identity,))
        result['task'] = self.task(latest[0]['id']) if latest else None
        return result

    def blocks(self, identity: str, version: int | None = None):
        """Ordered versioned blocks; defaults to the active extraction version."""
        document = self.document(identity)
        version = document['extraction_version'] if version is None else version
        rows = self.rows(
            "SELECT * FROM document_blocks WHERE document_id=? AND extraction_version=? ORDER BY ordinal",
            (identity, version))
        for row in rows:
            row['section_path'] = json.loads(row.pop('section_path_json'))
            row['location'] = json.loads(row.pop('location_json'))
        return rows

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
                relative_path = data.get('relative_path') or f"documents/{identity}.pdf"
                extension = Path(relative_path).suffix.lstrip('.').lower() or 'pdf'
                if extension not in FORMAT_MEDIA:
                    continue
                path = self.workspace.document_path(identity, extension)
                exists = self.rows("SELECT id FROM documents WHERE id=?", (identity,))
                if exists:
                    receipt.unlink()
                elif path.exists() and sha256(path.read_bytes()).hexdigest() == data['sha256']:
                    self.workspace.remove_document(identity, extension)
                    receipt.unlink()
                elif not path.exists():
                    receipt.unlink()
            except (ValueError, KeyError, OSError):
                continue
        for row in self.rows("SELECT id FROM documents WHERE deleted_at IS NOT NULL AND relative_path IS NOT NULL"):
            self.cleanup_deleted(row['id'])

    def cleanup_deleted(self, identity):
        try:
            rows = self.rows('SELECT relative_path FROM documents WHERE id=?', (identity,))
            extension = Path(rows[0]['relative_path']).suffix.lstrip('.').lower() if rows and rows[0]['relative_path'] else 'pdf'
            if extension not in FORMAT_MEDIA:
                extension = 'pdf'
            self.workspace.remove_document(identity, extension)
            with self.db.write() as conn:
                conn.execute("UPDATE documents SET relative_path=NULL,warning=NULL WHERE id=? AND deleted_at IS NOT NULL", (identity,))
            return True
        except OSError:
            return False

    def processor_for_import(self, format: str) -> str:
        # Imports always have the same lightweight baseline. Optional adapters
        # are selected explicitly for a reparse, never required by saved settings.
        return 'builtin'

    @staticmethod
    def format_for_name(original_name):
        extension = Path(original_name or '').suffix.lower().lstrip('.')
        if extension not in FORMAT_MEDIA:
            raise HTTPException(422, detail='UNSUPPORTED_FORMAT')
        return extension

    def import_document(self, source, original_name):
        format = self.format_for_name(original_name)
        media_type = FORMAT_MEDIA[format]
        source.seek(0, 2)
        size = source.tell()
        source.seek(0)
        if size > MAX_BYTES:
            raise HTTPException(413, detail='PDF_TOO_LARGE' if format == 'pdf' else 'FILE_TOO_LARGE')
        if format == 'pdf':
            if not source.read(1024).lstrip().startswith(b"%PDF-"):
                raise HTTPException(422, detail="NOT_PDF")
            source.seek(0)
        digest = sha256()
        while block := source.read(1024 * 1024):
            digest.update(block)
        source.seek(0)
        digest = digest.hexdigest()
        with self.operations:
            existing = self.rows("SELECT id,deleted_at,extraction_version,parse_version,version,format FROM documents WHERE sha256=?", (digest,))
            if existing and not existing[0]['deleted_at']:
                existing_format = existing[0]['format'] or 'pdf'
                if self.workspace.document_path(existing[0]['id'], existing_format).exists():
                    doc = self.document(existing[0]['id'])
                    tasks = self.rows("SELECT id FROM tasks WHERE target_id=? AND kind='extract' ORDER BY created_at DESC LIMIT 1", (doc['id'],))
                    return {"document": doc, "task": self.task(tasks[0]['id']) if tasks else None, "deduplicated": True}
            identity = existing[0]['id'] if existing else str(uuid4())
            parse_version = existing[0]['parse_version'] + 1 if existing else 1
            if existing and not self.cleanup_deleted(identity):
                raise HTTPException(409, detail="FILE_CLEANUP_PENDING")
            relative_path = f"documents/{identity}.{format}"
            receipt = self.workspace.root / "tmp" / f"import-{identity}.json"
            with receipt.open('w', encoding='utf-8') as output:
                import os
                json.dump({"document_id": identity, "sha256": digest, "relative_path": relative_path}, output)
                output.flush()
                os.fsync(output.fileno())
            try:
                self.workspace.store_document(source, identity, format)
                timestamp = now()
                task_id = str(uuid4())
                processor = self.processor_for_import(format)
                with self.db.write() as conn:
                    if existing:
                        conn.execute("UPDATE documents SET relative_path=?,deleted_at=NULL,extraction_status='pending',parse_version=?,parse_status='pending',parse_warning=NULL,version=version+1,warning=NULL,format=?,media_type=?,updated_at=? WHERE id=?", (relative_path,parse_version,format,media_type,timestamp,identity))
                    else:
                        name = (original_name or f'document.{format}').replace('\\','/').split('/')[-1][:255]
                        conn.execute("INSERT INTO documents(id,sha256,relative_path,original_name,extraction_status,format,media_type,parse_version,parse_status,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?,?, 'pending',?,?)", (identity,digest,relative_path,name,format,media_type,parse_version,timestamp,timestamp))
                    conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,input_json,created_at,updated_at) VALUES(?,'extract',?,'queued','QUEUED',?,?,?)", (task_id,identity,json.dumps({'parse_version': parse_version, 'processor': processor}),timestamp,timestamp))
                receipt.unlink(missing_ok=True)
            except Exception:
                # Reconciliation will only remove files with an owned receipt, never arbitrary files.
                self.reconcile()
                raise
            self.pool.submit(self.extract, identity, task_id, parse_version, processor, self.parser_service.docling_config() if self.parser_service else None)
            return {"document": self.document(identity), "task": self.task(task_id), "deduplicated": False}

    def import_pdf(self, source, original_name):
        return self.import_document(source, original_name)

    def active(self, identity, task_id):
        if self.closing.is_set():
            return False
        return bool(self.rows("SELECT t.id FROM tasks t JOIN documents d ON d.id=t.target_id WHERE t.id=? AND d.id=? AND d.deleted_at IS NULL AND t.status IN ('queued','running')", (task_id,identity)))

    def begin_parse(self, identity, increment=False):
        """Start (or advance) a parse attempt without taking the active version away."""
        with self.db.write() as conn:
            document = self.document(identity)
            version = document['parse_version'] + (1 if increment else 0)
            conn.execute("UPDATE documents SET parse_version=?,parse_status='running',parse_warning=NULL,parse_updated_at=?,updated_at=? WHERE id=?",
                         (version, now(), now(), identity))
            return version

    def _watch_cancel(self, identity, task_id, cancel):
        while not cancel.wait(0.2):
            if not self.active(identity, task_id):
                cancel.set()
                return

    def extract(self, identity, task_id, parse_version=None, processor=None, config=None):
        if parse_version is None or processor is None:
            task = self.task(task_id)
            parse_version = parse_version or (task.get('input') or {}).get('parse_version') or self.document(identity)['parse_version']
            processor = processor or (task.get('input') or {}).get('processor') or 'builtin'
        cancel = Event()
        try:
            with self.db.write() as conn:
                if not self.active(identity, task_id):
                    return
                conn.execute("UPDATE tasks SET status='running',stage='PARSING',updated_at=? WHERE id=?", (now(),task_id))
                conn.execute("UPDATE documents SET parse_status='running',parse_updated_at=? WHERE id=? AND parse_version=?", (now(),identity,parse_version))
            document = self.document(identity)
            registry, parser_name = (default_registry(config, include_external=processor == 'enhanced') if config else self.parser_service.registry() if self.parser_service else self.parsers), None
            if processor == 'enhanced':
                parser_name = 'docling'
            extension = document['format'] or 'pdf'
            request = ParseRequest(path=self.workspace.document_path(identity, extension), document_id=identity,
                                   extraction_version=parse_version, format=document['format'] or 'pdf',
                                   original_name=document['original_name'], parser_name=parser_name)
            watcher = Thread(target=self._watch_cancel, args=(identity, task_id, cancel), daemon=True)
            watcher.start()
            try:
                result = registry.parse(request, cancel)
            finally:
                cancel.set()
                watcher.join(timeout=1)
            self.finish_parse(identity, task_id, parse_version, result)
        except ParseError as error:
            if error.code == 'CANCELLED':
                return
            if error.code == 'ENCRYPTED_PDF':
                capability = self.parsers.capability('pdf')
                result = ParseResult(
                    format='pdf', media_type=capability.media_type or 'application/pdf',
                    parser_name=capability.parser or 'builtin-pdf', parser_version='unavailable',
                    config_fingerprint='unavailable', status='unsupported', warning='ENCRYPTED_PDF',
                    summary='PDF 已加密', page_count=None, blocks=[])
                self.finish_parse(identity, task_id, parse_version, result)
            else:
                self.fail_parse(identity, task_id, parse_version, error.code, error.message)
        except Exception:
            self.fail_parse(identity, task_id, parse_version, 'PARSER_FAILED')

    def finish_parse(self, identity, task_id, parse_version, result: ParseResult):
        """Switch the active version on success; keep the last usable version on failure."""
        with self.db.write() as conn:
            document = self.document(identity)
            if document['parse_version'] != parse_version or not self.active(identity, task_id):
                return False
            timestamp = now()
            success = result.status in ('ready', 'partial') and bool(result.blocks)
            warnings_json = json.dumps([warning.model_dump(mode='json') for warning in result.warnings], ensure_ascii=False)
            config_json = json.dumps({'fingerprint': result.config_fingerprint}, ensure_ascii=False)
            if success:
                conn.execute('DELETE FROM document_blocks WHERE document_id=? AND extraction_version=?', (identity, parse_version))
                for block in result.blocks:
                    conn.execute(
                        'INSERT INTO document_blocks(id,document_id,extraction_version,ordinal,block_type,text,'
                        'section_path_json,physical_page,location_json,heading_level) VALUES(?,?,?,?,?,?,?,?,?,?)',
                        (block.id, identity, parse_version, block.ordinal, block.type, block.text,
                         json.dumps(block.section_path, ensure_ascii=False), block.physical_page,
                         json.dumps(block.location.model_dump(mode='json'), ensure_ascii=False), block.heading_level))
                # PDF page/paragraph blocks also mirror into the legacy chunks index
                # so existing search and citation code keeps working during the migration.
                conn.execute('DELETE FROM chunks WHERE document_id=? AND extraction_version=?', (identity, parse_version))
                if result.format == 'pdf':
                    for block in result.blocks:
                        if block.physical_page:
                            conn.execute('INSERT INTO chunks(id,document_id,extraction_version,ordinal,physical_page,text) VALUES(?,?,?,?,?,?)',
                                         (block.id, identity, parse_version, block.ordinal, block.physical_page, block.text))
                sources = dict(document['metadata_source'])
                title, authors = document['title'], document['authors']
                source_label = 'pdf' if result.format == 'pdf' else result.parser_name
                if sources.get('title') != 'user' and result.metadata.title:
                    title, sources['title'] = result.metadata.title, source_label
                if sources.get('authors') != 'user' and result.metadata.authors:
                    authors, sources['authors'] = result.metadata.authors, source_label
                conn.execute(
                    'UPDATE documents SET extraction_version=?,extraction_status=?,warning=?,page_count=?,format=?,media_type=?,'
                    'parser_name=?,parser_version=?,parser_config_json=?,parse_warnings_json=?,parse_version=?,parse_status=?,'
                    'parse_warning=?,parse_updated_at=?,title=?,authors_json=?,metadata_source_json=?,active_index_generation=NULL,updated_at=? WHERE id=?',
                    (parse_version, result.status, result.warning, result.page_count, result.format, result.media_type,
                     result.parser_name, result.parser_version, config_json, warnings_json, parse_version, result.status,
                     result.warning, timestamp, title, json.dumps(authors), json.dumps(sources), timestamp, identity))
                conn.execute('DELETE FROM index_generations WHERE document_id=?', (identity,))
                conn.execute('DELETE FROM search_documents WHERE document_id=?', (identity,))
                conn.execute('DELETE FROM search_segments WHERE document_id=?', (identity,))
                conn.execute('DELETE FROM knowledge_sources WHERE source_key=?', (f'document:{identity}',))
            else:
                active = conn.execute('SELECT count(*) FROM document_blocks WHERE document_id=? AND extraction_version=?',
                                      (identity, document['extraction_version'])).fetchone()[0]
                keep_active = bool(active) and document['extraction_status'] in ('ready', 'partial')
                if keep_active:
                    conn.execute('UPDATE documents SET parse_version=?,parse_status=?,parse_warning=?,parse_updated_at=?,updated_at=? WHERE id=?',
                                 (parse_version, result.status, result.warning or 'PARSE_FAILED', timestamp, timestamp, identity))
                else:
                    conn.execute(
                        'UPDATE documents SET extraction_status=?,warning=?,page_count=?,format=?,media_type=?,parser_name=?,'
                        'parser_version=?,parser_config_json=?,parse_warnings_json=?,parse_version=?,parse_status=?,parse_warning=?,'
                        'parse_updated_at=?,updated_at=? WHERE id=?',
                        (result.status, result.warning, result.page_count, result.format, result.media_type,
                         result.parser_name, result.parser_version, config_json, warnings_json, parse_version, result.status,
                         result.warning or 'PARSE_FAILED', timestamp, timestamp, identity))
            task_status = 'failed' if result.status == 'failed' else 'succeeded'
            conn.execute('UPDATE tasks SET status=?,stage=?,progress=1,result_json=?,error_json=?,updated_at=? WHERE id=?',
                         (task_status, result.warning or 'COMPLETED',
                          json.dumps({'document_id': identity, 'extraction_status': result.status, 'block_count': len(result.blocks)}),
                          json.dumps({'code': result.warning}) if result.warning else None, timestamp, task_id))
            return True

    def fail_parse(self, identity, task_id, parse_version, code, message=''):
        with self.db.write() as conn:
            document = self.document(identity)
            if document['parse_version'] != parse_version or not self.active(identity, task_id):
                return False
            timestamp = now()
            active = conn.execute('SELECT count(*) FROM document_blocks WHERE document_id=? AND extraction_version=?',
                                  (identity, document['extraction_version'])).fetchone()[0]
            if active and document['extraction_status'] in ('ready', 'partial'):
                conn.execute('UPDATE documents SET parse_version=?,parse_status=\'failed\',parse_warning=?,parse_updated_at=?,updated_at=? WHERE id=?',
                             (parse_version, code, timestamp, timestamp, identity))
            else:
                conn.execute('UPDATE documents SET extraction_status=\'failed\',warning=?,parse_version=?,parse_status=\'failed\',parse_warning=?,parse_updated_at=?,updated_at=? WHERE id=?',
                             (code, parse_version, code, timestamp, timestamp, identity))
            conn.execute('UPDATE tasks SET status=\'failed\',stage=?,error_json=?,updated_at=? WHERE id=?',
                         (code, json.dumps({'code': code, 'message': message}), timestamp, task_id))
            return True

    def update(self, identity, metadata: Metadata):
        tags = normalize_tags(metadata.tags) if metadata.tags is not None else None
        supplied = metadata.model_fields_set
        with self.operations, self.db.write() as conn:
            doc = self.document(identity)
            if doc['version'] != metadata.version:
                raise HTTPException(409, detail="DOCUMENT_CONFLICT")
            if 'authors' in supplied and any(len(author) > 1000 for author in metadata.authors):
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
            title = metadata.title if 'title' in supplied else doc['title']
            authors = metadata.authors if 'authors' in supplied else doc['authors']
            year = metadata.year if 'year' in supplied else doc['year']
            sources = dict(doc['metadata_source'])
            for changed in ('title', 'authors', 'year'):
                if changed in supplied:
                    sources[changed] = 'user'
            if tags is not None:
                sources['tags'] = 'user'
                retained = {tag.casefold() for tag in tags}
                conn.executemany('INSERT OR IGNORE INTO enrichment_decisions VALUES(?,?,?)',
                    [(identity,doc['extraction_version'],'tag:'+tag.casefold()) for tag in doc['tags'] if tag.casefold() not in retained])
            if summary_changed:
                sources['summary'] = 'user'
            conn.execute(
                "UPDATE documents SET title=?,authors_json=?,year=?,metadata_source_json=?,summary_md=?,summary_source=?,summary_updated_at=?,version=version+1,updated_at=? WHERE id=?",
                (title, json.dumps(authors), year, json.dumps(sources),
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
                conn.execute("DELETE FROM document_blocks WHERE document_id=?", (identity,))
                conn.execute('DELETE FROM index_generations WHERE document_id=?', (identity,))
                conn.execute('DELETE FROM search_documents WHERE document_id=?', (identity,))
                conn.execute("UPDATE search_history SET status='cancelled',error_code='DOCUMENT_REMOVED',updated_at=? WHERE task_id IN (SELECT id FROM tasks WHERE target_id=? AND status IN ('queued','running'))", (timestamp,identity))
                conn.execute("UPDATE tasks SET status='cancelled',stage='DOCUMENT_REMOVED',updated_at=? WHERE target_id=? AND status IN ('queued','running')", (timestamp,identity))
            if getattr(self, 'previews', None):
                self.previews.remove(identity)
            return {"removed": True, "cleanup_pending": not self.cleanup_deleted(identity)}

    def retry(self, task_id):
        with self.operations, self.db.write() as conn:
            task = self.task(task_id)
            if task['kind'] != 'extract':
                raise HTTPException(409, detail='INVALID_INPUT')
            identity = task['target_id']
            document = self.document(identity)
            if self.rows("SELECT id FROM tasks WHERE target_id=? AND status IN ('queued','running')", (identity,)):
                raise HTTPException(409, detail="TASK_RUNNING")
            active = conn.execute('SELECT count(*) FROM document_blocks WHERE document_id=? AND extraction_version=?',
                                  (identity, document['extraction_version'])).fetchone()[0]
            keep_active = bool(active) and document['extraction_status'] in ('ready', 'partial')
            parse_version = document['parse_version'] + 1
            timestamp = now()
            conn.execute("UPDATE documents SET parse_version=?,parse_status='pending',parse_warning=NULL,parse_updated_at=?,"
                         "extraction_status=?,warning=?,updated_at=? WHERE id=?",
                         (parse_version, timestamp, document['extraction_status'] if keep_active else 'pending',
                          document['warning'] if keep_active else None, timestamp, identity))
            identity_task = str(uuid4())
            processor = (task.get('input') or {}).get('processor') or 'builtin'
            conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,input_json,created_at,updated_at) VALUES(?,'extract',?,'queued','QUEUED',?,?,?)",
                         (identity_task, identity, json.dumps({'parse_version': parse_version, 'processor': processor}), timestamp, timestamp))
        self.pool.submit(self.extract, identity, identity_task, parse_version, processor, self.parser_service.docling_config() if self.parser_service else None)
        return self.task(identity_task)

    def reparse(self, identity, processor='builtin'):
        """Explicitly reparse the stored file with the requested processor."""
        with self.operations, self.db.write() as conn:
            document = self.document(identity)
            if processor not in ('builtin', 'enhanced'):
                raise HTTPException(422, detail='INVALID_INPUT')
            if processor == 'enhanced':
                if not self.parser_service or not self.parser_service.enhanced_available(document['format']):
                    raise HTTPException(409, detail='COMPONENT_MISSING')
            if self.rows("SELECT id FROM tasks WHERE target_id=? AND status IN ('queued','running')", (identity,)):
                raise HTTPException(409, detail='TASK_RUNNING')
            active = conn.execute('SELECT count(*) FROM document_blocks WHERE document_id=? AND extraction_version=?',
                                  (identity, document['extraction_version'])).fetchone()[0]
            keep_active = bool(active) and document['extraction_status'] in ('ready', 'partial')
            parse_version = document['parse_version'] + 1
            timestamp = now()
            conn.execute("UPDATE documents SET parse_version=?,parse_status='pending',parse_warning=NULL,parse_updated_at=?,"
                         "extraction_status=?,warning=?,updated_at=? WHERE id=?",
                         (parse_version, timestamp, document['extraction_status'] if keep_active else 'pending',
                          document['warning'] if keep_active else None, timestamp, identity))
            identity_task = str(uuid4())
            conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,input_json,created_at,updated_at) VALUES(?,'extract',?,'queued','QUEUED',?,?,?)",
                         (identity_task, identity, json.dumps({'parse_version': parse_version, 'processor': processor}), timestamp, timestamp))
        self.pool.submit(self.extract, identity, identity_task, parse_version, processor, self.parser_service.docling_config() if self.parser_service else None)
        return self.task(identity_task)

    def file(self, identity: str):
        document = self.document(identity)
        try:
            path = self.workspace.document_path(identity, document['format'] or 'pdf')
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
                timestamp = now()
                parse_version = (task.get('input') or {}).get('parse_version')
                conn.execute("UPDATE tasks SET status='cancelled',stage='CANCELLED',updated_at=? WHERE id=?", (timestamp,task_id))
                row = conn.execute('SELECT extraction_version,extraction_status,deleted_at FROM documents WHERE id=?', (task['target_id'],)).fetchone()
                if row and row[2] is None and parse_version:
                    active = conn.execute('SELECT count(*) FROM document_blocks WHERE document_id=? AND extraction_version=?',
                                          (task['target_id'], row[0])).fetchone()[0]
                    if active and row[1] in ('ready', 'partial'):
                        conn.execute("UPDATE documents SET parse_status='cancelled',parse_warning='CANCELLED',parse_updated_at=?,updated_at=? WHERE id=? AND parse_version=?",
                                     (timestamp, timestamp, task['target_id'], parse_version))
                    else:
                        conn.execute("UPDATE documents SET extraction_status='failed',warning='CANCELLED',parse_status='cancelled',parse_warning='CANCELLED',parse_updated_at=?,updated_at=? WHERE id=? AND parse_version=?",
                                     (timestamp, timestamp, task['target_id'], parse_version))
        return self.task(task_id)

    def close(self):
        self.closing.set()
        self.pool.shutdown(wait=True, cancel_futures=True)


def router(library: Library):
    routes = APIRouter()
    @routes.post('/v1/documents/import')
    def import_document(file: UploadFile):
        try:
            return library.import_document(file.file, file.filename)
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
        document = library.document(identity)
        return FileResponse(library.file(identity), media_type=document['media_type'] or 'application/octet-stream')
    @routes.get('/v1/documents/{identity}/blocks')
    def blocks(identity: str):
        return {'items': library.blocks(identity)}
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
