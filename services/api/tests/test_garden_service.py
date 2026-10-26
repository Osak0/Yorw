from uuid import uuid4
import sqlite3
import urllib.error
import pytest
from test_search_service import running,ROOT

@pytest.mark.parametrize('frozen',[False,True])
def test_topics_revisions_http_and_restart(frozen,tmp_path):
    if frozen and not (ROOT/'dist/yorw-api/yorw-api.exe').exists():pytest.skip('Build backend first')
    workspace=tmp_path/'workspace'
    a,b=str(uuid4()),str(uuid4())
    with running(frozen,workspace) as (request,_):
        assert request('/v1/health')['schema_version']==11
        first=request('/v1/topics','POST',{'id':a,'title':'Medical research','parent_id':None})
        request('/v1/topics','POST',{'id':b,'title':'Reliability','parent_id':a})
        second=request('/v1/topics/'+a+'/revisions','POST',{'base_revision_id':first['revision']['id'],'body_md':'# Reliability\n\n人工正文'})
        with pytest.raises(urllib.error.HTTPError) as conflict:request('/v1/topics/'+a+'/revisions','POST',{'base_revision_id':first['revision']['id'],'body_md':'overwrite'})
        assert conflict.value.code==409
        with pytest.raises(urllib.error.HTTPError) as cycle:request('/v1/topics/'+a,'PATCH',{'title':'Cycle','parent_id':b,'version':second['topic']['version']})
        assert cycle.value.code==409
    with running(frozen,workspace) as (request,_):
        assert len(request('/v1/topics')['items'])==2
        assert request('/v1/topics/'+a)==second
        history=request('/v1/topics/'+a+'/revisions')['items']
        assert history[0]['body_md']=='# Reliability\n\n人工正文' and history[1]['body_md']==''
    with sqlite3.connect(workspace/'yorw.sqlite3') as conn:
        assert conn.execute('PRAGMA foreign_key_check').fetchall()==[]
