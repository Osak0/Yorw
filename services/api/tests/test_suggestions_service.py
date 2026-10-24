import time
from uuid import uuid4
import pytest
from test_chat_service import provider
from test_search_service import running,ROOT
from test_library import pdf_bytes

@pytest.mark.parametrize('frozen',[False,True])
def test_selected_materials_sse_draft_restart_without_body_overwrite(frozen,tmp_path):
    if frozen and not (ROOT/'dist/yorw-api/yorw-api.exe').exists():pytest.skip('Build backend first')
    workspace=tmp_path/'workspace'
    with provider() as (url,received):
        with running(frozen,workspace) as (request,upload):
            assert request('/v1/health')['schema_version']==9
            doc=upload(pdf_bytes())
            selected=request(f'/v1/documents/{doc}/search','POST',{'query':'English'})['items'][0]
            note=request('/v1/notes','POST',{'id':str(uuid4()),'document_id':doc,'body_md':'个人观点，不是原文结论。'})
            topic=request('/v1/topics','POST',{'id':str(uuid4()),'title':'Research wiki','parent_id':None})
            tid=topic['topic']['id']
            request('/v1/providers/chat','PUT',{'base_url':url,'model':'fixture','version':0})
            payload={'base_revision_id':topic['revision']['id'],'instruction':'整理本轮材料','materials':[{'kind':'document','id':doc,'version':str(selected['extraction_version']),'segment_ids':[selected['segment_id']]},{'kind':'note','id':note['id'],'version':'1','segment_ids':[]}]}
            preview=request(f'/v1/topics/{tid}/materials/preview','POST',payload)
            assert preview['sources'][1]['evidence']==[]
            args={**payload,'request_id':str(uuid4()),'config_version':1}
            suggestion=request(f'/v1/topics/{tid}/suggestions','POST',args,'fixture-key')
            for _ in range(150):
                suggestion=request(f'/v1/topics/{tid}/suggestions')['items'][0]
                if suggestion['status']!='running':break
                time.sleep(.02)
            assert suggestion['status']=='completed'
            assert request(f'/v1/topics/{tid}')==topic
            assert request(f'/v1/topics/{tid}/suggestions','POST',args,'fixture-key')['id']==suggestion['id']
            assert len(received)==1
            evidence=__import__('json').loads(received[0][1]['messages'][1]['content'])['evidence']
            assert evidence[0]['text']==selected['text'] and evidence[1]['kind']=='note'
            assert evidence[0]['evidence'][0]['quote']==selected['text']
        with running(frozen,workspace) as (request,_):
            restored=request(f'/v1/topics/{tid}/suggestions')['items'][0]
            assert restored['body_md']==suggestion['body_md'] and restored['status']=='completed'
            assert request(f'/v1/topics/{tid}')==topic
            request('/v1/notes/'+note['id'],'PATCH',{'body_md':'updated','version':1})
            stale=request(f'/v1/topics/{tid}/suggestions')['items'][0]
            assert stale['sources'][1]['excerpt']=='个人观点，不是原文结论。' and not stale['sources'][1]['available']
