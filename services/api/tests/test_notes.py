from io import BytesIO
import json
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
import pytest

from yorw_api.notes import Notes, NewNote, NoteBody
from yorw_api.storage.database import Database
from test_library import library, pdf_bytes, wait


def test_notes_isolation_restart_conflict_and_deleted_document(library):
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    notes = Notes(library.db)
    identity = str(uuid4())
    value = NewNote(id=identity, document_id=document['id'], body_md='# 我的理解\n\nNo invented evidence.')
    first = notes.create(value)
    assert notes.create(value) == first  # Lost create acknowledgement is idempotent.
    assert first['sources'] == [] and first['version'] == 1
    assert notes.list(str(uuid4())) == []
    assert notes.list(document['id']) == [first]
    other = wait(library, library.import_pdf(BytesIO(pdf_bytes(False)), 'other.pdf'))
    other_note = notes.create(NewNote(id=uuid4(), document_id=other['id'], body_md='Independent document note'))
    assert notes.list(other['id']) == [other_note]
    assert notes.list(document['id']) == [first]
    with library.db.write() as conn:
        conn.execute('UPDATE notes SET sources_json=? WHERE id=?', (json.dumps([{'fixture': 'snapshot retained'}]), identity))
    second = notes.update(identity, NoteBody(body_md='正文已改', version=1))
    assert second['version'] == 2 and second['sources'] == [{'fixture': 'snapshot retained'}]
    with pytest.raises(HTTPException) as conflict:
        notes.update(identity, NoteBody(body_md='stale overwrite', version=1))
    assert conflict.value.status_code == 409
    assert notes.list(document['id'])[0]['body_md'] == '正文已改'
    with pytest.raises(HTTPException):
        notes.create(value)  # A retry must not overwrite later edits.
    reopened = Database(library.workspace)
    assert Notes(reopened).list(document['id']) == [second]
    reopened.close()
    library.remove(document['id'], document['version'])
    retained = notes.list(document['id'])[0]
    assert retained['body_md'] == '正文已改' and not retained['document_available']
    with pytest.raises(HTTPException) as removed:
        notes.update(identity, NoteBody(body_md='cannot write', version=2))
    assert removed.value.status_code == 404
    assert notes.list(document['id'])[0]['version'] == 2


def test_note_write_failure_rolls_back_and_input_is_bounded(library):
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    notes = Notes(library.db)
    first = notes.create(NewNote(id=uuid4(), document_id=document['id'], body_md='persisted'))
    with library.db.write() as conn:
        conn.execute("CREATE TRIGGER fail_note BEFORE UPDATE ON notes BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;")
    import sqlite3
    with pytest.raises(sqlite3.IntegrityError):
        notes.update(first['id'], NoteBody(body_md='lost write', version=1))
    assert notes.list(document['id'])[0] == first
    for invalid in ({'version': True, 'body_md': 'x'}, {'version': 0, 'body_md': 'x'}, {'version': 1, 'body_md': 'x' * 200_001}, {'version': 1, 'body_md': 'x', 'sources': []}):
        with pytest.raises(ValidationError):
            NoteBody(**invalid)
