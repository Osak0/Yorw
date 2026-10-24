"""Version-checked, local Markdown notes. Manual notes do not invent evidence."""
from datetime import datetime, timezone
import json
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .storage.database import Database

MAX_NOTE_LENGTH = 200_000


class NoteBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body_md: str = Field(max_length=MAX_NOTE_LENGTH, strict=True)
    version: int = Field(ge=1, strict=True)


class NewNote(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    document_id: UUID
    body_md: str = Field(max_length=MAX_NOTE_LENGTH, strict=True)


class Notes:
    def __init__(self, database: Database):
        self.db = database

    def _document(self, identity: str):
        row = self.db.connection.execute("SELECT deleted_at FROM documents WHERE id=?", (identity,)).fetchone()
        if row is None or row[0] is not None:
            raise HTTPException(404, detail="DOCUMENT_NOT_FOUND")

    def _get(self, identity: str) -> dict:
        cursor = self.db.connection.execute(
            "SELECT n.*,d.deleted_at FROM notes n JOIN documents d ON d.id=n.document_id WHERE n.id=?", (identity,))
        row = cursor.fetchone()
        if row is None:
            raise HTTPException(404, detail="NOTE_NOT_FOUND")
        note = dict(zip((column[0] for column in cursor.description), row))
        note['sources'] = json.loads(note.pop('sources_json'))
        note['document_available'] = note.pop('deleted_at') is None
        for source in note['sources']:
            if isinstance(source, dict) and 'chunk_id' in source:
                live = self.db.connection.execute('SELECT extraction_version FROM chunks WHERE id=? AND document_id=?',(source['chunk_id'],note['document_id'])).fetchone()
                source['available'] = note['document_available'] and live is not None and live[0] == source.get('extraction_version')
        return note

    def list(self, document_id: str) -> list[dict]:
        # Tombstoned documents retain notes, with an explicit unavailable association.
        with self.db.lock:
            identities = self.db.connection.execute(
                "SELECT id FROM notes WHERE document_id=? ORDER BY created_at,id", (document_id,)).fetchall()
            return [self._get(row[0]) for row in identities]

    def create(self, value: NewNote) -> dict:
        identity, document_id = str(value.id), str(value.document_id)
        with self.db.write() as conn:
            self._document(document_id)
            existing = conn.execute("SELECT id FROM notes WHERE id=?", (identity,)).fetchone()
            if existing:
                note = self._get(identity)
                # A retry after a lost response must not create a duplicate or overwrite edits.
                if note['document_id'] == document_id and note['body_md'] == value.body_md and note['version'] == 1:
                    return note
                raise HTTPException(409, detail="NOTE_CONFLICT")
            timestamp = datetime.now(timezone.utc).isoformat()
            conn.execute("INSERT INTO notes(id,document_id,body_md,created_at,updated_at) VALUES(?,?,?,?,?)",
                         (identity, document_id, value.body_md, timestamp, timestamp))
            return self._get(identity)

    def update(self, identity: str, value: NoteBody) -> dict:
        with self.db.write() as conn:
            note = self._get(identity)
            self._document(note['document_id'])
            if note['version'] != value.version:
                raise HTTPException(409, detail="NOTE_CONFLICT")
            # Evidence snapshots belong to later source-aware flows; manual edits preserve them.
            conn.execute("UPDATE notes SET body_md=?,version=version+1,updated_at=? WHERE id=?",
                         (value.body_md, datetime.now(timezone.utc).isoformat(), identity))
            return self._get(identity)


def router(database: Database):
    routes = APIRouter()
    notes = Notes(database)

    @routes.get('/v1/notes')
    def list_notes(document_id: UUID):
        return {'items': notes.list(str(document_id))}

    @routes.post('/v1/notes')
    def create_note(note: NewNote):
        return notes.create(note)

    @routes.patch('/v1/notes/{identity}')
    def update_note(identity: UUID, note: NoteBody):
        return notes.update(str(identity), note)

    return routes
