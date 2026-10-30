from io import BytesIO
import json
import time
from uuid import uuid4
from zipfile import ZipFile
import pytest
from test_search_service import running,ROOT
from test_chat_service import provider
from test_library import pdf_bytes


@pytest.mark.parametrize('frozen',[False,True])
def test_accept_restore_export_and_restart(frozen,tmp_path):
    if frozen and not (ROOT/'dist/yorw-api/yorw-api.exe').exists():pytest.skip('Build backend first')
    workspace=tmp_path/'workspace'
    with provider() as (url,received):
        with running(frozen,workspace) as (request,upload):
            assert request('/v1/health')['schema_version']==23
            doc=upload(pdf_bytes())
            note=request('/v1/notes','POST',{'id':str(uuid4()),'document_id':doc,'body_md':'Saved note 中文\n'})
            topic=request('/v1/topics','POST',{'id':str(uuid4()),'title':'Review export','parent_id':None});tid=topic['topic']['id']
            request('/v1/providers/chat','PUT',{'base_url':url,'model':'fixture','version':0})
            selected=request(f'/v1/documents/{doc}/search','POST',{'query':'English'})['items'][0]
            suggestion=request(f'/v1/topics/{tid}/suggestions','POST',{'base_revision_id':topic['revision']['id'],'instruction':'整理','materials':[{'kind':'document','id':doc,'version':'1','segment_ids':[selected['segment_id']]}],'request_id':str(uuid4()),'config_version':1},'fixture-key')
            for _ in range(150):
                suggestion=request(f'/v1/topics/{tid}/suggestions')['items'][0]
                if suggestion['status']!='running':break
                time.sleep(.02)
            assert suggestion['status']=='completed'
            args={'request_id':str(uuid4()),'base_revision_id':topic['revision']['id'],'body_md':'人工核查的正文 [S1]'}
            accepted=request(f'/v1/suggestions/{suggestion["id"]}/accept','POST',args)
            assert request(f'/v1/suggestions/{suggestion["id"]}/accept','POST',args)==accepted
            rid=accepted['view']['revision']['id']
            restored=request(f'/v1/topics/{tid}/revisions/{topic["revision"]["id"]}/restore','POST',{'request_id':str(uuid4()),'base_revision_id':rid})
            final=request(f'/v1/topics/{tid}/revisions/{rid}/restore','POST',{'request_id':str(uuid4()),'base_revision_id':restored['view']['revision']['id']})['view']
            exported=request('/v1/exports','POST',{'note_ids':[note['id']],'topic_ids':[tid]})
            archive=request(f'/v1/exports/{exported["task_id"]}/file',binary=True)
            with ZipFile(BytesIO(archive)) as files:
                assert files.read(f'wiki/{tid}.md').decode()==args['body_md']
                assert files.read(f'notes/{note["id"]}.md').decode()==note['body_md']
                assert json.loads(files.read(f'wiki/{tid}.md.sources.json'))['sources'][0]['evidence'][0]['quote']==selected['text']
                assert not any('fixture-key' in files.read(n).decode() for n in files.namelist())
        with running(frozen,workspace) as (request,_):
            assert request(f'/v1/topics/{tid}')==final
            assert request(f'/v1/topics/{tid}/suggestions')['items'][0]['decision']['action']=='accept'
            assert request(f'/v1/exports/{exported["task_id"]}/file',binary=True)==archive
            assert len(request(f'/v1/topics/{tid}/revisions')['items'])==4
    assert len(received)==1
