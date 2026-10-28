"""Submitted document-search snapshots with dynamically computed source availability."""
import json
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException

from .library import now
from .storage.database import Database
from .source_status import evidence_available


class SearchHistory:
    def __init__(self, database: Database):
        self.db = database

    def create(self, conn, document_id: str, request_id: str, task_id: str, query: str):
        """Insert the submitted query inside the caller's transaction."""
        timestamp = now()
        conn.execute(
            "INSERT OR IGNORE INTO search_history(id,document_id,request_id,task_id,query,status,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)",
            (str(uuid4()), document_id, request_id, task_id, query, timestamp, timestamp))

    def mark_running(self, conn, task_id: str):
        conn.execute(
            "UPDATE search_history SET status='running',updated_at=? WHERE task_id=? AND status='queued'",
            (now(), task_id))

    def finish_with(self, conn, task_id: str, status: str, result=None, error_code=None):
        items = result.get('items') if isinstance(result, dict) else None
        reason = result.get('reason') if isinstance(result, dict) else None
        conn.execute(
            "UPDATE search_history SET status=?,error_code=?,results_json=?,reason=?,updated_at=? WHERE task_id=?",
            (status, error_code, json.dumps(items if isinstance(items, list) else [], ensure_ascii=False),
             reason, now(), task_id))

    def _available(self, ref: dict) -> bool:
        return evidence_available(self.db, ref)

    def _entry(self, row: dict) -> dict:
        try:
            items = json.loads(row.pop('results_json'))
        except (TypeError, ValueError):
            items = []
        if not isinstance(items, list):
            items = []
        for item in items:
            if not isinstance(item, dict):
                continue
            evidence = [ref for ref in item.get('evidence', []) if isinstance(ref, dict)]
            for ref in evidence:
                ref['available'] = self._available(ref)
            item['evidence'] = evidence
            item['available'] = bool(evidence) and all(ref['available'] for ref in evidence)
        row['items'] = items
        row['result_count'] = len(items)
        return row

    def list(self, document_id: str):
        with self.db.lock:
            cursor = self.db.connection.execute(
                'SELECT * FROM search_history WHERE document_id=? ORDER BY rowid DESC',
                (document_id,))
            names = [column[0] for column in cursor.description]
            return {'items': [self._entry(dict(zip(names, row))) for row in cursor.fetchall()]}

    def delete(self, document_id: str, identity: str):
        with self.db.write() as conn:
            row = conn.execute('SELECT id FROM search_history WHERE id=? AND document_id=?',
                               (identity, document_id)).fetchone()
            if not row:
                raise HTTPException(404, detail='SEARCH_HISTORY_NOT_FOUND')
            conn.execute('DELETE FROM search_history WHERE id=?', (identity,))
        return {'deleted': True}

    def clear(self, document_id: str):
        with self.db.write() as conn:
            cursor = conn.execute('DELETE FROM search_history WHERE document_id=?', (document_id,))
        return {'deleted': cursor.rowcount}


def router(database: Database):
    service, routes = SearchHistory(database), APIRouter()

    @routes.get('/v1/documents/{identity}/search-history')
    def list_history(identity: UUID):
        return service.list(str(identity))

    @routes.delete('/v1/documents/{identity}/search-history/{history_id}')
    def delete_history(identity: UUID, history_id: UUID):
        return service.delete(str(identity), str(history_id))

    @routes.delete('/v1/documents/{identity}/search-history')
    def clear_history(identity: UUID):
        return service.clear(str(identity))

    return routes
