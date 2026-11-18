"""Real source/frozen HTTP routes and durable decisions across service restarts."""
from uuid import uuid4
import pytest
from test_search_service import running


@pytest.mark.parametrize('frozen',[False,True])
def test_collaboration_http_restart_idempotence_and_undo(frozen,tmp_path):
    workspace=tmp_path/'workspace';owner=str(uuid4());proposal=None
    with running(frozen,workspace) as (request,_):
        assert request('/v1/health')['schema_version']==31
        request('/v1/topics','POST',{'id':owner,'title':'Fixture research','parent_id':None})
        proposal=request('/v1/collaboration/preview','POST',{'request_id':str(uuid4()),'topic_id':owner,'operations':[
            {'key':'topic','action':'create_topic','title':'Related experiment','reason':'Unverified research organization'},
            {'key':'note','action':'create_note','title':'Candidate','body_md':'A candidate, not a measured result.','owner':'$topic','reason':'Keep the hypothesis separate'},
            {'key':'relation','action':'link','first_kind':'topic','first':owner,'second_kind':'topic','second':'$topic','reason':'Related research questions'}]})
        assert len(request('/v1/topics')['items'])==1
        decision={'request_id':str(uuid4()),'version':proposal['version'],'selected':['topic','note','relation']}
        url='/v1/collaboration/proposals/'+proposal['id']+'/accept'
        accepted=request(url,'POST',decision)
        assert request(url,'POST',decision)['status']=='accepted'
        assert len(request('/v1/topics')['items'])==2
        assert request('/v1/topics/'+owner+'/overview')['relations']
    with running(frozen,workspace) as (request,_):
        accepted=request('/v1/collaboration/proposals/'+proposal['id'])
        assert accepted['status']=='accepted'
        assert request('/v1/collaboration/proposals?topic_id='+owner)['items'][0]['id']==proposal['id']
        undo={'request_id':str(uuid4()),'version':accepted['version'],'selected':[]}
        result=request('/v1/collaboration/proposals/'+proposal['id']+'/undo','POST',undo)
        assert result['status']=='undone'
        assert not request('/v1/collaboration/topics/'+owner+'/relations')['items']
        assert len(request('/v1/topics')['items'])==1
