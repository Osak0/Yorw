"""Rebuildable per-document keyword and exact-vector retrieval; never generates answers."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
import re
from threading import Event
from uuid import UUID, NAMESPACE_URL, uuid4, uuid5

import numpy as np
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .embedding import embed
from .library import Library, now
from .providers import ProbeError

CHUNK_VERSION = 'chars1000-overlap150-cjk-bigram-v1'
MAX_INDEX_SEGMENTS = 5000
BATCH_SIZE = 16


def tokens(text: str) -> list[str]:
    result = []
    for word in re.findall(r'[a-z0-9]+|[\u3400-\u9fff]+', text.casefold()):
        result.extend([word] if not re.fullmatch(r'[\u3400-\u9fff]{2,}', word) else [word[index:index + 2] for index in range(len(word) - 1)])
    return result


def split_text(text: str):
    start = 0
    while start < len(text):
        end = min(start + 1000, len(text))
        if end < len(text):
            boundary = max(text.rfind('\n', start + 500, end), text.rfind(' ', start + 500, end))
            if boundary > start:
                end = boundary + 1
        if text[start:end].strip():
            yield start, end, text[start:end]
        if end == len(text):
            break
        start = max(start + 1, end - 150)


def fingerprint(config: dict) -> str:
    return sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


class SearchInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    query: str = Field(min_length=1, max_length=1000)
    semantic: bool = Field(default=False, strict=True)
    config_version: int = Field(default=0, ge=0, strict=True)
    limit: int = Field(default=8, ge=1, le=20, strict=True)
    # Initial retrieval heuristic, not a calibrated relevance probability.
    min_similarity: float = Field(default=0.5, ge=0, le=1, strict=True)


class IndexInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    semantic: bool = Field(default=False, strict=True)
    config_version: int = Field(default=0, ge=0, strict=True)


class Search:
    def __init__(self, library: Library):
        self.library, self.db = library, library.db
        self.closing = Event()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='embedding-index')
        with self.db.write() as conn:
            conn.execute('DELETE FROM index_generations WHERE id NOT IN (SELECT active_index_generation FROM documents WHERE active_index_generation IS NOT NULL)')

    def config(self):
        rows = self.library.rows("SELECT kind,base_url,model,version FROM provider_configs WHERE kind='embedding'")
        return rows[0] if rows else None

    def ensure_segments(self, identity: str, rebuild=False):
        with self.db.write() as conn:
            doc = self.library.document(identity)
            if doc['extraction_status'] not in ('ready', 'partial'):
                raise HTTPException(409, detail='TEXT_NOT_READY')
            old = conn.execute('SELECT extraction_version,chunk_version FROM search_documents WHERE document_id=?', (identity,)).fetchone()
            if rebuild or old != (doc['extraction_version'], CHUNK_VERSION):
                conn.execute('UPDATE documents SET active_index_generation=NULL WHERE id=?', (identity,))
                conn.execute('DELETE FROM index_generations WHERE document_id=?', (identity,))
                conn.execute('DELETE FROM search_segments WHERE document_id=?', (identity,))
                for source in self.library.rows('SELECT * FROM chunks WHERE document_id=? AND extraction_version=? ORDER BY ordinal', (identity, doc['extraction_version'])):
                    for start, end, text in split_text(source['text']):
                        segment_id = str(uuid5(NAMESPACE_URL, f"{source['id']}:{CHUNK_VERSION}:{start}:{end}"))
                        conn.execute('INSERT INTO search_segments VALUES(?,?,?,?,?,?,?,?,?,?)', (segment_id,identity,source['id'],doc['extraction_version'],CHUNK_VERSION,source['physical_page'],start,end,text,' '.join(tokens(text))))
                conn.execute('INSERT INTO search_documents VALUES(?,?,?) ON CONFLICT(document_id) DO UPDATE SET extraction_version=excluded.extraction_version,chunk_version=excluded.chunk_version', (identity,doc['extraction_version'],CHUNK_VERSION))
            return doc

    def status(self, identity: str):
        with self.db.lock:
            doc = self.library.document(identity)
            meta = self.db.connection.execute('SELECT extraction_version,chunk_version FROM search_documents WHERE document_id=?', (identity,)).fetchone()
            current = meta == (doc['extraction_version'], CHUNK_VERSION) and doc['extraction_status'] in ('ready','partial')
            config = self.config()
            generation = self._generation(doc, config) if config else None
            tasks = self.library.rows("SELECT id FROM tasks WHERE kind='index' AND target_id=? ORDER BY created_at DESC LIMIT 1", (identity,))
            return {'keyword_ready': current, 'segments': self.db.connection.execute('SELECT count(*) FROM search_segments WHERE document_id=?', (identity,)).fetchone()[0] if current else 0,
                    'semantic_ready': bool(generation), 'dimension': generation['dimension'] if generation else None,
                    'chunk_version': CHUNK_VERSION, 'extraction_version': doc['extraction_version'],
                    'config': config, 'task': self.library.task(tasks[0]['id']) if tasks else None}

    def _generation(self, doc, config):
        if doc['extraction_status'] not in ('ready','partial'):
            return None
        rows = self.library.rows('SELECT * FROM index_generations WHERE id=? AND document_id=? AND extraction_version=? AND chunk_version=? AND config_fingerprint=? AND complete=1',
                                 (doc['active_index_generation'],doc['id'],doc['extraction_version'],CHUNK_VERSION,fingerprint(config)))
        return rows[0] if rows else None

    def start(self, identity: str, value: IndexInput, key: str):
        # Check before rebuilding: a local rebuild is explicitly destructive only to derived indexes.
        with self.db.lock:
            if self.library.rows("SELECT id FROM tasks WHERE kind='index' AND target_id=? AND status IN ('queued','running')", (identity,)):
                raise HTTPException(409, detail='TASK_RUNNING')
            config = self.config()
            if value.semantic:
                if not config or config['version'] != value.config_version:
                    raise HTTPException(409, detail='CONFIG_CHANGED')
                if not key:
                    raise HTTPException(409, detail='KEY_MISSING')
            self.ensure_segments(identity, rebuild=not value.semantic)
            segments = self.library.rows('SELECT * FROM search_segments WHERE document_id=? ORDER BY physical_page,start_offset', (identity,))
            if not segments:
                raise HTTPException(409, detail='TEXT_NOT_READY')
            if value.semantic and len(segments) > MAX_INDEX_SEGMENTS:
                raise HTTPException(409, detail='INDEX_TOO_LARGE')
            task_id = str(uuid4())
            with self.db.write() as conn:
                conn.execute('INSERT INTO tasks(id,kind,target_id,status,stage,progress,input_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
                             (task_id,'index',identity,'queued' if value.semantic else 'succeeded','QUEUED' if value.semantic else 'KEYWORD_READY',0 if value.semantic else 1,json.dumps({'semantic': value.semantic, 'config_version': value.config_version}),now(),now()))
            if value.semantic:
                self.pool.submit(self._build, identity, task_id, config, key, segments)
            return self.library.task(task_id)

    def _check(self, identity, task_id, config, extraction_version):
        if self.closing.is_set():
            raise ProbeError('INTERRUPTED')
        task = self.library.task(task_id)
        if task['status'] not in ('queued','running'):
            raise ProbeError('CANCELLED')
        doc = self.library.document(identity)
        if doc['extraction_version'] != extraction_version or doc['extraction_status'] not in ('ready','partial'):
            raise ProbeError('INDEX_SOURCE_CHANGED')
        if self.config() != config:
            raise ProbeError('CONFIG_CHANGED')

    def _build(self, identity, task_id, config, key, segments):
        generation = str(uuid4())
        version = segments[0]['extraction_version']
        try:
            with self.db.write() as conn:
                self._check(identity,task_id,config,version)
                conn.execute("UPDATE tasks SET status='running',stage='EMBEDDING',updated_at=? WHERE id=?", (now(),task_id))
                conn.execute('INSERT INTO index_generations(id,document_id,extraction_version,chunk_version,config_fingerprint,config_json,created_at) VALUES(?,?,?,?,?,?,?)',
                             (generation,identity,version,CHUNK_VERSION,fingerprint(config),json.dumps(config),now()))
            dimension = None
            for offset in range(0, len(segments), BATCH_SIZE):
                with self.db.lock:
                    self._check(identity,task_id,config,version)
                batch = segments[offset:offset+BATCH_SIZE]
                vectors = embed(config,key,[item['text'] for item in batch],dimension)
                dimension = len(vectors[0])
                with self.db.write() as conn:
                    self._check(identity,task_id,config,version)
                    conn.executemany('INSERT INTO embeddings VALUES(?,?,?)', [(item['id'],generation,vector.tobytes()) for item,vector in zip(batch,vectors)])
                    conn.execute('UPDATE tasks SET progress=?,updated_at=? WHERE id=?', (min((offset+len(batch))/len(segments),.99),now(),task_id))
            with self.db.write() as conn:
                self._check(identity,task_id,config,version)
                conn.execute('UPDATE index_generations SET dimension=?,complete=1 WHERE id=?', (dimension,generation))
                conn.execute('UPDATE documents SET active_index_generation=? WHERE id=?', (generation,identity))
                conn.execute('DELETE FROM index_generations WHERE document_id=? AND id!=?', (identity,generation))
                conn.execute("UPDATE tasks SET status='succeeded',stage='SEMANTIC_READY',progress=1,updated_at=? WHERE id=?", (now(),task_id))
        except Exception as error:
            code = error.code if isinstance(error,ProbeError) else error.detail if isinstance(error,HTTPException) else 'INDEX_FAILED'
            with self.db.write() as conn:
                conn.execute('DELETE FROM index_generations WHERE id=?', (generation,))
                conn.execute("UPDATE tasks SET status=?,stage=?,error_json=?,updated_at=? WHERE id=? AND status IN ('queued','running')",
                             ('interrupted' if code=='INTERRUPTED' else 'failed',code,json.dumps({'code':code}),now(),task_id))
        finally:
            key = ''

    def cancel(self, identity: str):
        with self.db.write() as conn:
            task = self.library.task(identity)
            if task['kind'] != 'index':
                raise HTTPException(404, detail='TASK_NOT_FOUND')
            conn.execute("UPDATE tasks SET status='cancelled',stage='CANCELLED',updated_at=? WHERE id=? AND status IN ('queued','running')", (now(),identity))
        return self.library.task(identity)

    def query(self, identity: str, value: SearchInput, key: str):
        self.ensure_segments(identity)
        words = list(dict.fromkeys(tokens(value.query)))[:32]
        expression = ' OR '.join('"'+word+'"' for word in words)
        with self.db.lock:
            doc = self.library.document(identity)
            config = self.config()
            generation = self._generation(doc,config) if config else None
            segments = {item['id']: item for item in self.library.rows('SELECT * FROM search_segments WHERE document_id=?', (identity,))}
            keyword = self.library.rows('SELECT segment_id,bm25(chunks_fts) AS score FROM chunks_fts WHERE chunks_fts MATCH ? AND document_id=? ORDER BY score LIMIT 40', (expression,identity)) if expression else []
        semantic, reason = [], None
        similarities: dict[str, float] = {}
        if value.semantic:
            reason = 'CONFIG_MISSING' if not config else 'CONFIG_CHANGED' if config['version'] != value.config_version else 'KEY_MISSING' if not key else 'INDEX_NOT_READY' if not generation else None
            if reason is None:
                try:
                    query_vector = embed(config,key,[value.query],generation['dimension'])[0]
                    with self.db.lock:
                        if self.config() != config or not self._generation(self.library.document(identity),config) or self.library.document(identity)['active_index_generation'] != generation['id']:
                            raise ProbeError('INDEX_SOURCE_CHANGED')
                        rows = self.library.rows('SELECT segment_id,vector FROM embeddings WHERE generation_id=?', (generation['id'],))
                    for row in rows:
                        vector = np.frombuffer(row['vector'],dtype='<f4')
                        if len(vector) != generation['dimension'] or not np.isfinite(vector).all():
                            raise ProbeError('DIMENSION_CHANGED')
                        score = float(np.dot(vector,query_vector))
                        if not np.isfinite(score):
                            raise ProbeError('INVALID_RESPONSE')
                        score = max(-1., min(1., score))
                        similarities[row['segment_id']] = score
                        if score > 0 and score >= value.min_similarity:
                            semantic.append({'segment_id':row['segment_id'],'score':score})
                    semantic.sort(key=lambda item: (-item['score'],item['segment_id']))
                    semantic = semantic[:40]
                except ProbeError as error:
                    semantic, reason = [], error.code
                except Exception:
                    semantic, reason = [], 'EMBEDDING_FAILED'
        # Re-read source/config after a network wait. Never return evidence from an invalidated index.
        with self.db.lock:
            latest = self.library.document(identity)
            if latest['extraction_version'] != doc['extraction_version'] or latest['extraction_status'] not in ('ready','partial'):
                raise HTTPException(409, detail='INDEX_SOURCE_CHANGED')
            if value.semantic and self.config() != config:
                semantic, reason = [], 'CONFIG_CHANGED'
            if generation and latest['active_index_generation'] != generation['id']:
                semantic, reason = [], 'INDEX_SOURCE_CHANGED'
            live = {row['id'] for row in self.library.rows('SELECT id FROM search_segments WHERE document_id=?', (identity,))}
        scores, methods = {}, {}
        for method, items in [('keyword',keyword),('semantic',semantic)]:
            for rank,item in enumerate(items,1):
                segment_id = item['segment_id']
                if segment_id in segments and segment_id in live:
                    # Union: lexical matches remain eligible independently of cosine.
                    scores[segment_id] = scores.get(segment_id,0) + 1/(60+rank)
                    methods.setdefault(segment_id,[]).append(method)
        items = []
        semantic_rank = {item['segment_id']: rank for rank,item in enumerate(semantic)}
        for segment_id in sorted(scores,key=lambda item: (-scores[item],semantic_rank.get(item,1_000_000),item))[:value.limit]:
            segment = segments[segment_id]
            items.append({**{name:segment[name] for name in ('chunk_id','physical_page','text','extraction_version','chunk_version','start_offset','end_offset')},
                          'segment_id':segment_id,'document_id':identity,'document_title':latest['title'] or latest['original_name'], 'methods':methods[segment_id],'score':scores[segment_id],
                          'similarity':similarities.get(segment_id) if value.semantic and reason is None else None})
        return {'items':items, 'query':value.query, 'mode':'hybrid' if value.semantic and reason is None else 'keyword', 'reason':reason,
                'extraction_status':latest['extraction_status'], 'chunk_version':CHUNK_VERSION,
                'min_similarity':value.min_similarity,
                'best_similarity':max(similarities.values(), default=None) if value.semantic and reason is None else None}

    def close(self):
        self.closing.set()
        self.pool.shutdown(wait=True,cancel_futures=False)


def router(search: Search):
    routes = APIRouter()

    @routes.get('/v1/documents/{identity}/index')
    def status(identity: UUID):
        return search.status(str(identity))

    @routes.post('/v1/documents/{identity}/index')
    def build(identity: UUID, value: IndexInput, x_provider_key: str = Header(default='')):
        return search.start(str(identity),value,x_provider_key)

    @routes.post('/v1/documents/{identity}/search')
    def query(identity: UUID, value: SearchInput, x_provider_key: str = Header(default='')):
        return search.query(str(identity),value,x_provider_key)

    @routes.post('/v1/search/tasks/{identity}/cancel')
    def cancel(identity: UUID):
        return search.cancel(str(identity))

    return routes
