"""Versioned content blocks, schema migration and citation compatibility."""
from io import BytesIO
import json
from pathlib import Path
import shutil
from unittest.mock import patch

from test_library import library, pdf_bytes, wait

from yorw_api.notes import Notes
from yorw_api.parsing import ContentBlock, ParseResult, SourceLocation, stable_block_id
from yorw_api.search_history import SearchHistory
from yorw_api.source_status import resolve_evidence, source_status
from yorw_api.storage.database import Database
from yorw_api.storage.workspace import Workspace


def parse_result(identity, version, text='Reparsed evidence', status='ready', page=2):
    block = ContentBlock(
        id=stable_block_id(identity, version, 0), ordinal=0, type='page', text=text,
        physical_page=page, location=SourceLocation(kind='page', physical_page=page, block_ordinal=0))
    return ParseResult(format='pdf', media_type='application/pdf', parser_name='builtin-pdf',
                       parser_version='test', config_fingerprint='test', status=status,
                       page_count=page, blocks=[block])


def create_task(library, identity, task_id, version):
    with library.db.write() as conn:
        conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,input_json,created_at,updated_at) "
                     "VALUES(?,'extract',?,'running','EXTRACTING',?,'time','time')",
                     (task_id, identity, json.dumps({'parse_version': version})))


def test_schema15_upgrade_backfills_blocks_and_keeps_legacy_citations(tmp_path):
    scripts = tmp_path / 'schema15'
    scripts.mkdir()
    for path in sorted((Path(__file__).parents[1] / 'src/yorw_api/migrations').glob('*.sql'))[:15]:
        shutil.copy2(path, scripts / path.name)
    workspace = Workspace(tmp_path / 'workspace')
    old = Database(workspace, scripts)
    citation = {'chunk_id': 'chunk', 'document_id': 'doc', 'physical_page': 1,
                'extraction_version': 1, 'quote': 'Retained evidence'}
    with old.write() as conn:
        conn.execute("INSERT INTO documents(id,sha256,original_name,title,authors_json,extraction_status,created_at,updated_at) "
                     "VALUES('doc','digest','paper.pdf','Retained paper','[\"Author\"]','ready','time','time')")
        conn.execute("INSERT INTO chunks(id,document_id,extraction_version,ordinal,physical_page,text) "
                     "VALUES('chunk','doc',1,0,1,'Retained evidence')")
        conn.execute("INSERT INTO notes(id,document_id,body_md,sources_json,created_at,updated_at) VALUES('note','doc','Note',?,'time','time')",
                     (json.dumps([citation]),))
        conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,created_at,updated_at) VALUES('task','ai_search','doc','succeeded','READY','time','time')")
        conn.execute("INSERT INTO search_history(id,document_id,request_id,task_id,query,status,results_json,created_at,updated_at) "
                     "VALUES('history','doc','request','task','q','succeeded',?,'time','time')",
                     (json.dumps([{'evidence': [citation]}]),))
    old.close()
    upgraded = Database(workspace)
    try:
        assert upgraded.version == 20
        document = upgraded.connection.execute(
            'SELECT format,media_type,parse_version,parse_status,extraction_version FROM documents').fetchone()
        assert document == ('pdf', 'application/pdf', 1, 'ready', 1)
        block = dict(zip([item[0] for item in upgraded.connection.execute('SELECT * FROM document_blocks').description],
                         upgraded.connection.execute('SELECT * FROM document_blocks').fetchone()))
        assert block['id'] == 'chunk' and block['block_type'] == 'page' and block['physical_page'] == 1
        assert json.loads(block['section_path_json']) == []
        assert resolve_evidence(upgraded, citation)['block_id'] == 'chunk'
        assert resolve_evidence(upgraded, {**citation, 'chunk_id': None, 'block_id': 'chunk'})['physical_page'] == 1
        assert Notes(upgraded)._get('note')['sources'][0]['available'] is True
        history = SearchHistory(upgraded).list('doc')['items'][0]
        assert history['items'][0]['available'] is True
        source = {'kind': 'document', 'source_object_id': 'doc', 'source_version': '1', 'evidence': [citation]}
        assert source_status(upgraded, [source])[0]['available'] is True
        assert len(list((workspace.root / 'backups').glob('*.sqlite3'))) == 1
        assert upgraded.connection.execute('PRAGMA foreign_key_check').fetchall() == []
    finally:
        upgraded.close()


def test_new_pdf_import_writes_matching_blocks_and_chunks(library):
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    assert document['format'] == 'pdf' and document['media_type'] == 'application/pdf'
    assert document['parser_name'] == 'builtin-pdf' and document['parse_status'] == 'ready'
    blocks = library.blocks(document['id'])
    chunks = library.rows('SELECT id,text FROM chunks WHERE document_id=?', (document['id'],))
    assert len(blocks) == 1 and blocks[0]['block_type'] == 'page'
    assert blocks[0]['id'] == chunks[0]['id'] and blocks[0]['text'] == chunks[0]['text']
    evidence = {'document_id': document['id'], 'document_title': 'Fixture title',
                'block_id': blocks[0]['id'], 'chunk_id': chunks[0]['id'], 'physical_page': 1,
                'quote': blocks[0]['text'], 'extraction_version': document['extraction_version']}
    resolved = resolve_evidence(library.db, evidence)
    assert resolved['block_id'] == blocks[0]['id'] and resolved['physical_page'] == 1


def test_successful_reparse_switches_version_and_invalidates_derived_indexes(library):
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    identity, old_version = document['id'], document['extraction_version']
    old_block = library.blocks(identity)[0]
    with library.db.write() as conn:
        conn.execute('INSERT INTO search_documents VALUES(?,?,?)', (identity, old_version, 'test'))
        conn.execute("INSERT INTO search_segments VALUES('seg',?,?,?, 'test',1,0,5,'hello','hello')",
                     (identity, old_block['id'], old_version))
        conn.execute("INSERT INTO index_generations(id,document_id,extraction_version,chunk_version,config_fingerprint,config_json,complete,created_at) "
                     "VALUES('gen',?,?,'test','fp','{}',1,'time')", (identity, old_version))
        conn.execute("UPDATE documents SET active_index_generation='gen' WHERE id=?", (identity,))
    version = library.begin_parse(identity, increment=True)
    create_task(library, identity, 'task', version)
    assert library.finish_parse(identity, 'task', version, parse_result(identity, version)) is True
    current = library.document(identity)
    assert current['extraction_version'] == version and current['extraction_status'] == 'ready'
    assert current['parse_version'] == version and current['parse_status'] == 'ready'
    assert current['active_index_generation'] is None
    assert library.rows('SELECT document_id FROM search_documents') == []
    assert library.rows('SELECT id FROM search_segments') == []
    assert library.rows('SELECT id FROM index_generations') == []
    assert len(library.blocks(identity, old_version)) == 1
    assert len(library.blocks(identity, version)) == 1
    assert resolve_evidence(library.db, {'document_id': identity, 'block_id': old_block['id'],
                                         'physical_page': 1, 'quote': old_block['text'],
                                         'extraction_version': old_version}) is None
    assert resolve_evidence(library.db, {'document_id': identity, 'block_id': stable_block_id(identity, version, 0),
                                         'physical_page': 2, 'quote': 'Reparsed evidence',
                                         'extraction_version': version})['physical_page'] == 2
    assert library.task('task')['status'] == 'succeeded'


def test_failed_reparse_keeps_the_last_usable_version(library):
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    identity, old_version = document['id'], document['extraction_version']
    with library.db.write() as conn:
        conn.execute("INSERT INTO index_generations(id,document_id,extraction_version,chunk_version,config_fingerprint,config_json,complete,created_at) "
                     "VALUES('gen',?,?,'test','fp','{}',1,'time')", (identity, old_version))
    version = library.begin_parse(identity, increment=True)
    create_task(library, identity, 'task', version)
    assert library.fail_parse(identity, 'task', version, 'PARSER_FAILED') is True
    current = library.document(identity)
    assert current['extraction_version'] == old_version and current['extraction_status'] == 'ready'
    assert current['parse_version'] == version and current['parse_status'] == 'failed'
    assert current['parse_warning'] == 'PARSER_FAILED' and current['warning'] is None
    assert len(library.blocks(identity, old_version)) == 1
    assert library.rows('SELECT id FROM index_generations') == [{'id': 'gen'}]
    assert library.task('task')['status'] == 'failed'
    assert resolve_evidence(library.db, {'document_id': identity, 'block_id': library.blocks(identity)[0]['id'],
                                         'physical_page': 1, 'quote': library.blocks(identity)[0]['text'],
                                         'extraction_version': old_version}) is not None


def test_first_parse_failure_has_no_active_version(library):
    with patch.object(library.pool, 'submit'):
        result = library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf')
    identity = result['document']['id']
    version = library.begin_parse(identity)
    create_task(library, identity, 'task', version)
    assert library.fail_parse(identity, 'task', version, 'PDF_PARSE_FAILED') is True
    current = library.document(identity)
    assert current['extraction_status'] == 'failed' and current['warning'] == 'PDF_PARSE_FAILED'
    assert current['parse_status'] == 'failed' and current['parse_warning'] == 'PDF_PARSE_FAILED'
    assert library.blocks(identity) == []


def test_non_pdf_block_evidence_has_sections_without_pages(library):
    with library.db.write() as conn:
        conn.execute("INSERT INTO documents(id,sha256,original_name,title,authors_json,extraction_status,format,media_type,parser_name,parser_version,parse_status,created_at,updated_at) "
                     "VALUES('docx','digest2','paper.docx','Docx','[]','ready','docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','builtin-docx','1','ready','time','time')")
        conn.execute("INSERT INTO document_blocks(id,document_id,extraction_version,ordinal,block_type,text,section_path_json,physical_page,location_json,heading_level) "
                     "VALUES('block','docx',1,0,'paragraph','Methods evidence','[\"Methods\"]',NULL,'{\"kind\":\"block\",\"block_ordinal\":0}',NULL)")
    evidence = {'document_id': 'docx', 'block_id': 'block', 'physical_page': None,
                'quote': 'Methods evidence', 'extraction_version': 1}
    resolved = resolve_evidence(library.db, evidence)
    assert resolved['section_path'] == ['Methods'] and resolved['physical_page'] is None
    assert resolve_evidence(library.db, {**evidence, 'quote': 'absent'}) is None


def test_notes_and_search_history_accept_block_evidence(library):
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    identity = document['id']
    block = library.blocks(identity)[0]
    evidence = {'document_id': identity, 'document_title': 'Fixture title', 'block_id': block['id'],
                'physical_page': 1, 'quote': block['text'], 'extraction_version': document['extraction_version']}
    with library.db.write() as conn:
        conn.execute("INSERT INTO notes(id,document_id,body_md,sources_json,created_at,updated_at) VALUES('note',?,'Note',?,'time','time')",
                     (identity, json.dumps([evidence])))
        conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,created_at,updated_at) VALUES('task','ai_search',?,'succeeded','READY','time','time')", (identity,))
        conn.execute("INSERT INTO search_history(id,document_id,request_id,task_id,query,status,results_json,created_at,updated_at) "
                     "VALUES('history',?,'request','task','q','succeeded',?,'time','time')",
                     (identity, json.dumps([{'evidence': [evidence]}])))
    assert Notes(library.db)._get('note')['sources'][0]['available'] is True
    history = SearchHistory(library.db).list(identity)['items'][0]
    assert history['items'][0]['available'] is True


def test_cancelled_parse_cannot_publish_or_fail(library):
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    identity = document['id']
    version = library.begin_parse(identity, increment=True)
    create_task(library, identity, 'cancel-race', version)
    library.cancel('cancel-race')
    assert library.finish_parse(identity, 'cancel-race', version, parse_result(identity, version)) is False
    assert library.fail_parse(identity, 'cancel-race', version, 'PARSER_FAILED') is False
    assert library.task('cancel-race')['status'] == 'cancelled'
    assert library.document(identity)['extraction_version'] == document['extraction_version']


def test_restart_clears_pending_parse_preserving_active_version(library):
    from yorw_api.library import Library
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    library.begin_parse(document['id'], increment=True)
    create_task(library, document['id'], 'restart-parse', 2)
    recovered = Library(library.db)
    try:
        assert recovered.task('restart-parse')['status'] == 'interrupted'
        current = recovered.document(document['id'])
        assert current['parse_status'] == 'failed'
        assert current['parse_warning'] == 'INTERRUPTED'
        assert current['extraction_version'] == document['extraction_version']
        assert current['extraction_status'] == 'ready'
    finally:
        recovered.pool.shutdown(wait=True)
