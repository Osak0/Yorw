import json
from uuid import uuid4
import pytest
from test_search_service import running


@pytest.mark.parametrize('frozen',[False,True])
def test_notebook_http_and_restart_preserve_scope_head_and_immutable_revisions(frozen,tmp_path):
    owner,other,note=[str(uuid4()) for _ in range(3)];workspace=tmp_path/'workspace'
    with running(frozen,workspace) as (request,upload):
        assert request('/v1/health')['schema_version']==28
        for identity in (owner,other):request('/v1/topics','POST',{'id':identity,'title':'Owned fixture '+identity[:4],'parent_id':None})
        created=request('/v1/topics/'+owner+'/notebooks','POST',{'id':note,'title':'Fixture note'})
        saved=request('/v1/topics/'+note+'/revisions','POST',{'base_revision_id':created['base_revision_id'],'body_md':'Owned continuity evidence'})
        value=request('/v1/topics/'+other+'/note-scope')
        request('/v1/topics/'+other+'/note-scope','PUT',{'version':value['version'],'rules':{other:True,owner:True}})
        assert request('/v1/topics/'+other+'/overview')['notes'][0]['id']==note
        assert note not in {t['id'] for t in request('/v1/topics')['items']}
        assert note in {t['id'] for t in request('/v1/exports/catalog')['topics']}
    with running(frozen,workspace) as (request,upload):
        assert request('/v1/notebooks/'+note)['body_md']=='Owned continuity evidence'
        assert note in {n['id'] for n in request('/v1/notebooks')['items']}
        assert owner in request('/v1/topics/'+other+'/note-scope')['selected']
        history=request('/v1/topics/'+note+'/revisions')['items']
        assert len(history)==2 and history[0]['id']==saved['revision']['id']
