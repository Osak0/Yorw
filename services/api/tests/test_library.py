from io import BytesIO
import json
from pathlib import Path
import time
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from yorw_api.library import Library, Metadata
from yorw_api.storage.database import Database
from yorw_api.storage.workspace import Workspace


def pdf_bytes(text=True, encrypted=False):
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=400)
    if text:
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        content = DecodedStreamObject()
        content.set_data(b'BT /F1 12 Tf 20 200 Td (Yorw fixed English fixture evidence.) Tj ET')
        page[NameObject('/Contents')] = writer._add_object(content)
    writer.add_metadata({'/Title': 'Fixture title', '/Author': 'Fixture Author'})
    if encrypted:
        writer.encrypt('fixture-password')
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


@pytest.fixture
def library(tmp_path):
    database = Database(Workspace(tmp_path / 'workspace'))
    service = Library(database)
    yield service
    service.close()
    database.close()


def wait(service, result):
    for _ in range(200):
        task = service.task(result['task']['id'])
        if task['status'] not in ('queued', 'running'):
            return service.document(result['document']['id'])
        time.sleep(.01)
    pytest.fail('Extraction did not complete')


def test_import_deduplicate_extract_edit_restart_delete(library):
    content = pdf_bytes()
    result = library.import_pdf(BytesIO(content), 'fixture.pdf')
    document = wait(library, result)
    assert document['extraction_status'] == 'ready'
    assert document['title'] == 'Fixture title'
    assert document['year'] is None
    assert document['page_count'] == 1
    chunks = library.rows('SELECT physical_page,text FROM chunks WHERE document_id=?', (document['id'],))
    assert chunks[0]['physical_page'] == 1 and 'fixed English fixture evidence' in chunks[0]['text']
    duplicate = library.import_pdf(BytesIO(content), 'renamed.pdf')
    assert duplicate['deduplicated'] and duplicate['document']['id'] == document['id']
    edited = library.update(document['id'], Metadata(version=document['version'], title='Manual title', authors=['Osako'], year=2026))
    assert edited['metadata_source']['title'] == 'user'
    with pytest.raises(HTTPException) as conflict:
        library.update(document['id'], Metadata(version=document['version']))
    assert conflict.value.status_code == 409
    workspace = library.workspace
    reopened = Database(Workspace(workspace.root))
    assert reopened.connection.execute('SELECT title FROM documents').fetchone() == ('Manual title',)
    reopened.close()
    library.remove(edited['id'], edited['version'])
    assert library.list() == []
    assert not workspace.document_path(edited['id']).exists()
    assert library.rows('SELECT id FROM chunks') == []
    restored = wait(library, library.import_pdf(BytesIO(content), 'restored.pdf'))
    assert restored['id'] == edited['id']
    assert restored['extraction_version'] > document['extraction_version']
    assert restored['title'] == 'Manual title'


@pytest.mark.parametrize('content,status,warning', [(pdf_bytes(False), 'unsupported', 'NO_TEXT_NO_OCR'), (pdf_bytes(encrypted=True), 'unsupported', 'ENCRYPTED_PDF'), (b'%PDF-1.7 broken', 'failed', 'PDF_PARSE_FAILED')])
def test_import_unsupported_and_corrupt_files(library, content, status, warning):
    document = wait(library, library.import_pdf(BytesIO(content), 'fixture.pdf'))
    assert document['extraction_status'] == status and document['warning'] == warning
    assert library.rows('SELECT id FROM chunks') == []


def test_non_pdf_and_oversize_do_not_create_records(library):
    with pytest.raises(HTTPException):
        library.import_pdf(BytesIO(b'not a PDF'), 'fake.pdf')
    with patch('yorw_api.library.MAX_BYTES', 10), pytest.raises(HTTPException):
        library.import_pdf(BytesIO(pdf_bytes()), 'large.pdf')
    assert library.list() == []
    assert list((library.workspace.root / 'documents').iterdir()) == []


def test_delete_while_pending_cannot_recreate_chunks(library):
    with patch.object(library.pool, 'submit'):
        result = library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf')
    library.remove(result['document']['id'], result['document']['version'])
    library.extract(result['document']['id'], result['task']['id'])
    assert library.task(result['task']['id'])['status'] == 'cancelled'
    assert library.rows('SELECT * FROM chunks') == []


def test_recovery_only_cleans_receipted_orphans(library):
    identity = library.workspace.store_document(BytesIO(pdf_bytes()))
    unknown = library.workspace.store_document(BytesIO(b'unknown file'))
    path = library.workspace.document_path(identity)
    from hashlib import sha256
    receipt = library.workspace.root / 'tmp' / f'import-{identity}.json'
    receipt.write_text(json.dumps({'document_id': identity, 'sha256': sha256(path.read_bytes()).hexdigest()}))
    library.reconcile()
    assert not path.exists() and not receipt.exists()
    assert library.workspace.document_path(unknown).exists()


def test_restart_marks_inflight_interrupted_and_retry_uses_new_task(library):
    with patch.object(library.pool, 'submit'):
        result = library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf')
    library.close()
    recovered = Library(library.db)
    try:
        assert recovered.task(result['task']['id'])['status'] == 'interrupted'
        retry = recovered.retry(result['task']['id'])
        assert retry['id'] != result['task']['id']
        document = wait(recovered, {'document': result['document'], 'task': retry})
        assert document['extraction_status'] == 'ready'
    finally:
        recovered.close()


def test_cancelled_task_and_reimport_missing_file(library):
    with patch.object(library.pool, 'submit'):
        result = library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf')
    library.cancel(result['task']['id'])
    library.extract(result['document']['id'], result['task']['id'])
    assert library.task(result['task']['id'])['status'] == 'cancelled'
    assert library.rows('SELECT * FROM chunks') == []
    library.workspace.remove_document(result['document']['id'])
    restored = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    assert restored['extraction_status'] == 'ready'


def test_partial_pdf_keeps_physical_page_numbers(library):
    from pypdf import PdfReader
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.add_page(PdfReader(BytesIO(pdf_bytes())).pages[0])
    stream = BytesIO()
    writer.write(stream)
    document = wait(library, library.import_pdf(BytesIO(stream.getvalue()), 'partial.pdf'))
    assert document['extraction_status'] == 'partial'
    assert library.rows('SELECT physical_page FROM chunks') == [{'physical_page': 2}]


def test_publication_db_failure_cleans_only_owned_file(library):
    original = library.db.write
    from contextlib import contextmanager
    calls = 0
    @contextmanager
    def fail_once():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise OSError('injected commit failure')
        with original() as conn:
            yield conn
    with patch.object(library.db, 'write', fail_once), pytest.raises(OSError):
        library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf')
    assert library.list() == []
    assert list((library.workspace.root / 'documents').iterdir()) == []


def test_encrypted_pdf_missing_cipher_dependency_is_reported_as_unsupported(library):
    from pypdf.errors import DependencyError
    with patch('yorw_api.library.PdfReader', side_effect=DependencyError('cipher unavailable')):
        document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'encrypted-fixture.pdf'))
    assert document['extraction_status'] == 'unsupported'
    assert document['warning'] == 'ENCRYPTED_PDF'


def test_position_bounds_persistence_and_deleted_files(library):
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    identity = document['id']
    original_version = document['version']
    assert library.file(identity).read_bytes() == pdf_bytes()
    assert library.save_position(identity, 1) == {'page': 1}
    for page in [0, -1, 2, True, 1.5]:
        with pytest.raises(HTTPException):
            library.save_position(identity, page)
    assert library.document(identity)['version'] == original_version
    connection = Database(Workspace(library.workspace.root))
    assert connection.connection.execute('SELECT last_page FROM documents WHERE id=?',(identity,)).fetchone() == (1,)
    connection.close()
    library.remove(identity, original_version)
    with pytest.raises(HTTPException):
        library.file(identity)
    with pytest.raises(HTTPException):
        library.save_position(identity, 1)
