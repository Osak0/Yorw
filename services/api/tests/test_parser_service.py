"""Parser settings, enhanced selection, capability detection, and reparse safety."""
from io import BytesIO
import json
import sys
import time

import pytest
from fastapi import HTTPException

from test_docling_adapter import fake_script
from test_library import pdf_bytes, wait

from yorw_api.parsing import DoclingConfig
from yorw_api.library import Library
from yorw_api.parsers import ParserService, ParserSettingsInput
from yorw_api.storage.database import Database
from yorw_api.storage.workspace import Workspace


def settings(**values):
    base = {'approved': True, 'enhanced_enabled': False, 'docling_executable': '', 'docling_prefix': [],
            'libreoffice_executable': '', 'timeout_seconds': 600,
            'ocr_enabled': True, 'ocr_mode': 'default', 'version': 1}
    base.update(values)
    return ParserSettingsInput(**base)


def settle(library, task):
    for _ in range(300):
        current = library.task(task['id'])
        if current['status'] not in ('queued', 'running'):
            return current
        time.sleep(0.01)
    pytest.fail('parse task did not finish')


@pytest.fixture
def stack(tmp_path):
    database = Database(Workspace(tmp_path / 'workspace'))
    service = ParserService(database)
    library = Library(database, parser_service=service)
    yield database, service, library
    library.close()
    database.close()


def test_parser_settings_persist_and_reject_stale_versions(stack, tmp_path):
    _, service, _ = stack
    initial = service.settings()
    assert initial['version'] == 1 and initial['enhanced_enabled'] is False
    saved = service.save(settings(enhanced_enabled=True, docling_executable='docling.exe',
                                  docling_prefix=['-m', 'docling'], timeout_seconds=120,
                                  ocr_enabled=False, ocr_mode='full_page', version=1))
    assert saved['version'] == 2 and saved['enhanced_enabled'] is True
    assert saved['docling_prefix'] == ['-m', 'docling'] and saved['ocr_enabled'] is False
    with pytest.raises(HTTPException) as conflict:
        service.save(settings(version=1))
    assert conflict.value.detail == 'CONFIG_CONFLICT'


def test_capabilities_report_builtin_and_external_options(stack, tmp_path):
    _, service, _ = stack
    script_dir = tmp_path / 'capability'
    script_dir.mkdir()
    script = fake_script(script_dir)
    service.save(settings(enhanced_enabled=True, version=1))
    service.docling_config = lambda: DoclingConfig(executable=sys.executable, prefix_args=[str(script)], timeout_seconds=20)
    status = service.status(force=True)
    rows = {(item['processor'], item['format']): item for item in status['capabilities']}
    assert rows[('builtin', 'pdf')]['state'] == 'builtin'
    assert rows[('docling', 'pdf')]['state'] == 'external'
    assert '9.9.9' in status['components']['docling']['version']
    assert status['components']['docling']['available'] is True
    tested = service.test()
    assert tested['tested_at'] and tested['components']['docling']['available'] is True


def test_enhanced_import_and_explicit_reparse_choose_the_requested_parser(stack, tmp_path):
    _, service, library = stack
    script_dir = tmp_path / 'enhanced'
    script_dir.mkdir()
    script = fake_script(script_dir)
    service.save(settings(enhanced_enabled=True, version=1))
    service.docling_config = lambda: DoclingConfig(executable=sys.executable, prefix_args=[str(script)], timeout_seconds=20)
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    assert document['parser_name'] == 'builtin-pdf'
    settle(library, library.reparse(document['id'], 'enhanced'))
    document = library.document(document['id'])
    assert document['parser_name'] == 'docling' and document['parse_status'] == 'partial'
    assert {'heading', 'paragraph', 'table'} <= {block['block_type'] for block in library.blocks(document['id'])}
    argv = json.loads((script_dir / 'argv.json').read_text(encoding='utf-8'))
    assert '--ocr' in argv and '--to' in argv

    task = settle(library, library.reparse(document['id'], 'builtin'))
    assert task['status'] == 'succeeded'
    current = library.document(document['id'])
    assert current['parser_name'] == 'builtin-pdf' and current['parse_status'] == 'ready'
    assert [block['block_type'] for block in library.blocks(document['id'])] == ['page']

    settle(library, library.reparse(document['id'], 'enhanced'))
    assert library.document(document['id'])['parser_name'] == 'docling'


def test_ocr_setting_is_passed_to_the_external_parser(stack, tmp_path):
    _, service, library = stack
    script_dir = tmp_path / 'ocr-off'
    script_dir.mkdir()
    script = fake_script(script_dir)
    service.save(settings(enhanced_enabled=True, version=1))
    service.docling_config = lambda: DoclingConfig(executable=sys.executable, prefix_args=[str(script)], ocr=False,timeout_seconds=20)
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    settle(library, library.reparse(document['id'], 'enhanced'))
    argv = json.loads((script_dir / 'argv.json').read_text(encoding='utf-8'))
    assert '--no-ocr' in argv and '--ocr' not in argv


def test_enhanced_reparse_without_component_keeps_active_version(stack):
    _, _, library = stack
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    with pytest.raises(HTTPException) as error:
        library.reparse(document['id'], 'enhanced')
    assert error.value.detail == 'COMPONENT_MISSING'
    current = library.document(document['id'])
    assert current['extraction_version'] == document['extraction_version']
    assert current['parser_name'] == 'builtin-pdf' and current['parse_status'] == 'ready'
    assert len(library.blocks(document['id'])) == 1


def test_failed_enhanced_reparse_keeps_the_last_usable_version(stack, tmp_path):
    _, service, library = stack
    document = wait(library, library.import_pdf(BytesIO(pdf_bytes()), 'fixture.pdf'))
    script_dir = tmp_path / 'failing'
    script_dir.mkdir()
    script = fake_script(script_dir, fail=True)
    service.save(settings(enhanced_enabled=True, version=1))
    service.docling_config = lambda: DoclingConfig(executable=sys.executable, prefix_args=[str(script)], timeout_seconds=20)
    task = settle(library, library.reparse(document['id'], 'enhanced'))
    assert task['status'] == 'failed' and task['error']['code'] == 'PARSER_FAILED'
    current = library.document(document['id'])
    assert current['extraction_version'] == document['extraction_version']
    assert current['extraction_status'] == 'ready'
    assert current['parse_status'] == 'failed' and current['parse_warning'] == 'PARSER_FAILED'
    assert len(library.blocks(document['id'])) == 1
