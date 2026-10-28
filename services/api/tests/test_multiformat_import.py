"""Generic multi-format import, structured blocks and export locations."""
from io import BytesIO
import json
from uuid import uuid4
from zipfile import ZipFile

import pytest
from fastapi import HTTPException

from test_builtin_parsers import fixtures
from test_library import library, pdf_bytes, wait

from yorw_api.exports import ExportSelection, Exports
from yorw_api.library import Library


def import_document(library, name, data):
    return wait(library, library.import_document(BytesIO(data), name))


def test_generic_import_creates_format_blocks_and_managed_files(library):
    cases = [
        ('fixture.md', b'# Title\n\nParagraph.\n\n## Methods\n\n- item\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', {'heading', 'paragraph', 'list_item', 'table'}),
        ('fixture.txt', 'First paragraph.\n\nSecond paragraph.'.encode('utf-8'), {'paragraph'}),
        ('fixture.docx', fixtures.docx_bytes(), {'heading', 'paragraph', 'table'}),
        ('fixture.pdf', pdf_bytes(), {'page'}),
    ]
    for name, data, expected in cases:
        document = import_document(library, name, data)
        format = name.rsplit('.', 1)[1]
        assert document['format'] == format and document['parse_status'] == 'ready'
        path = library.workspace.document_path(document['id'], format)
        assert path.is_file() and library.file(document['id']) == path
        blocks = library.blocks(document['id'])
        assert expected <= {block['block_type'] for block in blocks}
        if format == 'pdf':
            assert all(block['physical_page'] for block in blocks)
        else:
            assert all(block['physical_page'] is None for block in blocks)


def test_generic_import_deduplicates_and_rejects_unknown_extensions(library):
    first = import_document(library, 'fixture.docx', fixtures.docx_bytes())
    duplicate = library.import_document(BytesIO(fixtures.docx_bytes()), 'renamed.docx')
    assert duplicate['deduplicated'] is True and duplicate['document']['id'] == first['id']
    with pytest.raises(HTTPException) as error:
        library.import_document(BytesIO(b'unknown'), 'fixture.xyz')
    assert error.value.detail == 'UNSUPPORTED_FORMAT'


def test_removing_non_pdf_document_deletes_managed_file_and_blocks(library):
    document = import_document(library, 'fixture.md', b'# Title\n\nBody.')
    path = library.workspace.document_path(document['id'], 'md')
    assert path.is_file() and library.blocks(document['id'])
    library.remove(document['id'], document['version'])
    assert not path.exists()
    assert library.rows('SELECT id FROM document_blocks WHERE document_id=?', (document['id'],)) == []


def test_export_source_manifest_adds_format_and_block_location(library):
    document = import_document(library, 'fixture.md', b'# Title\n\n## Methods\n\nEvidence paragraph.')
    block = next(item for item in library.blocks(document['id']) if item['block_type'] == 'paragraph')
    evidence = {'document_id': document['id'], 'document_title': 'Title', 'block_id': block['id'],
                'physical_page': None, 'quote': block['text'],
                'extraction_version': document['extraction_version'], 'section_path': block['section_path']}
    note_id = str(uuid4())
    with library.db.write() as conn:
        conn.execute("INSERT INTO notes(id,document_id,body_md,sources_json,created_at,updated_at) VALUES(?,?,'Note',?,'time','time')",
                     (note_id, document['id'], json.dumps([evidence])))
    service = Exports(library.db)
    task = service.create(ExportSelection(note_ids=[note_id], topic_ids=[]))
    data = service.file(task['task_id'])
    with ZipFile(BytesIO(data)) as archive:
        metadata = json.loads(archive.read(f'notes/{note_id}.md.sources.json'))
    source = metadata['sources'][0]
    assert source['source_format'] == 'md'
    assert source['location'] == {'kind': 'block', 'block_id': block['id'], 'section_path': ['Title', 'Methods']}
