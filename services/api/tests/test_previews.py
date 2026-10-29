"""Preview mapping must never turn ambiguity into a confirmed citation."""
import json
from threading import Event
from unittest.mock import patch
from io import BytesIO
import time
import pytest
from fastapi import HTTPException
from test_library import library, pdf_bytes, wait
from yorw_api.previews import locate_blocks, normalized, Previews
from yorw_api.parsers import ParserService, ParserSettingsInput
from yorw_api.parsing.docx import DocxParser
from yorw_api.parsing import ParseRequest
import zipfile


def test_exact_crosspage_and_ambiguous_mapping():
    blocks=[{'id':'cross','text':'Alpha beta gamma'},{'id':'repeat','text':'Repeated'},{'id':'missing','text':'Absent'}]
    result=locate_blocks(blocks,['Repeated\nAlpha beta','gamma\nRepeated'])
    assert [item['page'] for item in result['cross']]==[1,2]
    margins=locate_blocks([{'id':'span','text':'Unique alpha beta ending'}],['Header\nUnique alpha\nFooter','Header\nbeta ending\nFooter'])
    assert [item['quote'] for item in margins['span']]==['Unique alpha','beta ending']
    assert 'repeat' not in result and 'missing' not in result
    table=locate_blocks([{'id':'table','block_type':'table','text':'Metric | Value\n--- | ---\nRecall | 0.9'}],['Metric Value\nRecall 0.9'])
    assert table['table'][0]['page']==1
    assert locate_blocks([{'id':'hyphen','text':'hyphenated'}],['hyphen-\nated'])['hyphen'][0]['page']==1


def test_high_word_heading_keeps_nested_sections(tmp_path):
    path=tmp_path/'headings.docx'
    ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    paragraphs=''.join(f'<w:p><w:pPr><w:pStyle w:val="Heading{i}"/></w:pPr><w:r><w:t>Heading {i}</w:t></w:r></w:p>' for i in range(1,10))
    with zipfile.ZipFile(path,'w') as archive:
        archive.writestr('word/document.xml',f'<w:document xmlns:w="{ns}"><w:body>{paragraphs}</w:body></w:document>')
        archive.writestr('[Content_Types].xml','<Types/>')
        styles=''.join(f'<w:style w:styleId="Heading{i}"><w:name w:val="heading {i}"/></w:style>' for i in range(1,10))
        archive.writestr('word/styles.xml',f'<w:styles xmlns:w="{ns}">{styles}</w:styles>')
    result=DocxParser().parse(ParseRequest(path=path,document_id='headings',format='docx',original_name=path.name,extraction_version=1),Event())
    assert len(result.blocks)==9
    assert [block.heading_level for block in result.blocks]==[1,2,3,4,5,6,6,6,6]
    assert len(result.blocks[-1].section_path)==8


def test_status_never_executes_and_legacy_paths_are_unapproved(library):
    service=ParserService(library.db)
    service.save(ParserSettingsInput(enhanced_enabled=True,docling_executable='python.exe',version=1))
    with patch('subprocess.run',side_effect=AssertionError('status must not execute')):
        assert service.status()['components']['docling']['available'] is False
    assert service.docling_config().executable==''
    with pytest.raises(HTTPException):
        service.save(ParserSettingsInput(enhanced_enabled=True,docling_prefix=['-c','print(1)'],version=2))


def test_preview_identity_and_source_version_isolation(library):
    doc=wait(library,library.import_pdf(BytesIO(pdf_bytes()),'fixture.pdf'))
    previews=Previews(library,ParserService(library.db))
    try:
        with pytest.raises(HTTPException):previews.start(doc['id'])
        with pytest.raises(HTTPException):previews.path('../anything')
        with library.db.write() as conn:
            conn.execute("INSERT INTO document_previews VALUES('11111111-1111-4111-8111-111111111111',?,'test','ready',NULL,?,'now')",(doc['id'],json.dumps([library.blocks(doc['id'])[0]['text']])))
        preview='11111111-1111-4111-8111-111111111111'
        block=library.blocks(doc['id'])[0]
        assert previews.location(doc['id'],preview,block['id'])['matched']
        assert not previews.location(doc['id'],preview,'old-missing-id')['matched']
        previews.remove(doc['id'])
        with pytest.raises(HTTPException):previews.status(doc['id'],preview)
    finally:previews.close()

def test_preview_cache_cancel_and_config_versions(library,tmp_path):
    doc=wait(library,library.import_pdf(BytesIO(pdf_bytes()),'fixture.pdf'))
    executable=tmp_path/'soffice.exe';executable.write_bytes(b'converter-version-one')
    settings=ParserService(library.db)
    settings.save(ParserSettingsInput(approved=True,enhanced_enabled=False,libreoffice_executable=str(executable),version=1))
    with library.db.write() as conn:conn.execute("UPDATE documents SET format='docx' WHERE id=?",(doc['id'],))
    previews=Previews(library,settings)
    try:
        with patch.object(previews.pool,'submit') as submit:
            first=previews.start(doc['id'])
            assert previews.start(doc['id'])['id']==first['id']
            assert submit.call_count==1
            previews.cancel(doc['id'],first['id'])
            assert previews.events[first['id']].is_set()
            # A cancelled converter callback cannot publish a ready result.
            previews.generate(doc['id'],first['id'],'docx',str(executable),1,previews.events[first['id']])
            assert previews.status(doc['id'],first['id'])['status']=='cancelled'
            executable.write_bytes(b'converter-version-two')
            second=previews.start(doc['id'])
            assert second['id']!=first['id']
            assert submit.call_count==2
    finally:previews.close()

def test_approval_restore_requires_current_settings(library):
    from yorw_api.parsers import router
    service=ParserService(library.db)
    approve=next(route.endpoint for route in router(service,library).routes if route.path=='/v1/parsers/approve')
    assert not service.approved
    current=service.settings();current.pop('singleton',None)
    assert approve(ParserSettingsInput(**current))=={'approved':True}
    assert service.approved
    with pytest.raises(HTTPException):approve(ParserSettingsInput(**{**current,'version':0}))
