from io import BytesIO
from zipfile import ZipFile
from threading import Event
from unittest.mock import patch
import pytest
from yorw_api.original_view import original_docx
from yorw_api.parsing import ParseError
from yorw_api.library import Library
from yorw_api.parsers import ParserService, ParserSettingsInput
from test_library import library, wait, pdf_bytes
from test_builtin_parsers import fixtures

W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
A='http://schemas.openxmlformats.org/drawingml/2006/main'


def flattened(node):
    return node.get('text','')+''.join(flattened(child) for child in node.get('children',[]))


def test_original_docx_without_any_external_component(tmp_path):
    path=tmp_path/'source.docx';path.write_bytes(fixtures.docx_bytes())
    with patch('subprocess.run',side_effect=AssertionError('must not execute external component')):
        value=original_docx(path)
    assert value['kind']=='docx'
    assert 'self-written DOCX fixture' in flattened(value['content'])
    tables=[node for node in value['content']['children'] if node['type']=='table']
    assert len(tables)==1 and len(tables[0]['children'])>=2
    assert 'Recall' in flattened(tables[0])


def test_docx_original_blocks_external_resources_and_active_images(tmp_path):
    path=tmp_path/'unsafe.docx'
    body=f'<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>中文 original evidence</w:t><w:drawing><a:blip r:embed="external"/></w:drawing><w:drawing><a:blip r:embed="svg"/></w:drawing></w:r></w:p></w:body></w:document>'
    with ZipFile(path,'w') as archive:
        archive.writestr('word/document.xml',body)
        archive.writestr('word/_rels/document.xml.rels','<Relationships><Relationship Id="external" Target="https://example.invalid/image.png" TargetMode="External"/><Relationship Id="svg" Target="media/active.svg"/></Relationships>')
        archive.writestr('word/media/active.svg','<svg onload="alert(1)"/>')
    view=original_docx(path)
    assert view['content']['children'][0]['children'][0]['bold']
    assert '中文 original evidence' in flattened(view['content'])
    assert 'https://' not in str(view) and 'onload' not in str(view)
    assert len(view['warnings'])==2


def test_docx_original_rejects_xml_entities(tmp_path):
    path=tmp_path/'entity.docx'
    with ZipFile(path,'w') as archive:archive.writestr('word/document.xml','<!DOCTYPE x [<!ENTITY evil SYSTEM "file:///etc/passwd">]><x/>')
    with pytest.raises(ParseError):original_docx(path)


def test_stale_enhanced_setting_cannot_block_builtin_import(library):
    service=ParserService(library.db)
    service.save(ParserSettingsInput(approved=True,enhanced_enabled=True,docling_executable='missing-docling.exe',version=1))
    library.parser_service=service
    with patch('subprocess.run',side_effect=AssertionError('baseline must not probe components')):
        document=wait(library,library.import_document(BytesIO(fixtures.docx_bytes()),'source.docx'))
    assert document['parse_status']=='ready' and document['parser_name']=='builtin-docx'
    assert library.processor_for_import('pdf')=='builtin'
    assert original_docx(library.file(document['id']))['kind']=='docx'

def test_empty_table_cells_also_obey_preview_node_limit(tmp_path,monkeypatch):
    import yorw_api.original_view as preview
    path=tmp_path/'many-cells.docx'
    with ZipFile(path,'w') as archive:
        archive.writestr('word/document.xml',f'<w:document xmlns:w="{W}"><w:body><w:tbl><w:tr><w:tc/><w:tc/></w:tr></w:tbl></w:body></w:document>')
    monkeypatch.setattr(preview,'MAX_NODES',3)
    with pytest.raises(ParseError) as error:original_docx(path)
    assert error.value.code=='OUTPUT_TOO_LARGE'
