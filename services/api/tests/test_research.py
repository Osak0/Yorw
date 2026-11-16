import json
import time
from threading import Event
from uuid import uuid4
import pytest
from fastapi import HTTPException
from test_library import library,pdf_bytes,wait
from yorw_api.research import Research,Ask,SessionEdit
from yorw_api.research_tools import ResearchTools
from yorw_api.providers import ProbeError
from yorw_api.garden import Garden,CreateTopic,SaveBody


def doc(library):
    from io import BytesIO
    task=library.import_pdf(BytesIO(pdf_bytes()),'owned.pdf')
    wait(library,task)
    return task['document']['id']


def profile(library):
    identity=str(uuid4())
    with library.db.write() as conn:
        conn.execute('INSERT INTO model_profiles(id,name,provider,base_url,model,version,tools_check,updated_at) VALUES(?,?,?,?,?,1,?,?)',(identity,'Fixture','compatible','http://127.0.0.1:1','fixture',json.dumps({'ok':True}),'time'))
    return identity


def ask(identity,question='What is the fixture evidence?',**kwargs):
    return Ask(profile_id=identity,config_version=1,question=question,request_id=uuid4(),**kwargs)


def finish(service,sid):
    for _ in range(300):
        view=service.view(sid)
        if view['items'] and view['items'][-1]['status']!='running':return view
        time.sleep(.01)
    pytest.fail('research did not settle')


class Model:
    def __init__(self):self.requests=[]
    def __call__(self,config,key,messages,schemas,validators,stop,deadline,max_tokens,**kwargs):
        self.requests.append(json.loads(json.dumps(messages)))
        tools=[m for m in messages if m['role']=='tool']
        if not tools:
            name,args='search_local',{'query':'fixture'}
        elif len(tools)==1:
            found=json.loads(tools[-1]['content'])['items']
            assert found
            name,args='read_local',{'handle':found[0]['handle']}
        else:
            source=json.loads(tools[-1]['content'])
            return {'role':'assistant','content':'The evidence is in the material ['+source['citation']+'].'},[],None
        value=validators[name](args)
        identity='call-'+str(len(tools))
        message={'role':'assistant','content':'','tool_calls':[{'id':identity,'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]}
        return message,[(identity,name,value)],None


def test_scope_tools_search_read_and_outside_handle_rejected(library):
    did=doc(library)
    garden=Garden(library.db);topic=garden.create(CreateTopic(id=uuid4(),title='A',parent_id=None))['topic']['id']
    tools=ResearchTools(library,{'mode':'topic','topic_id':topic})
    assert tools.execute('search_local',{'query':'fixture'})['items']==[]
    with library.db.write() as conn:conn.execute('INSERT INTO document_topics(document_id,topic_id,created_at) VALUES(?,?,?)',(did,topic,'time'))
    tools=ResearchTools(library,{'mode':'topic','topic_id':topic})
    found=tools.execute('search_local',{'query':'fixture'})['items']
    assert found
    source=tools.execute('read_local',{'handle':found[0]['handle']})
    assert source['citation']=='S1' and source['document_id']==did
    with pytest.raises(ValueError):tools.validate('read_local',{'handle':did})
    with library.db.write() as conn:conn.execute('DELETE FROM document_topics WHERE document_id=?',(did,))
    with pytest.raises(ProbeError):tools.execute('read_local',{'handle':found[0]['handle']})


def test_session_idempotence_history_events_and_read_only(library):
    doc(library);pid=profile(library);model=Model();service=Research(library,model)
    try:
        value=ask(pid);started=service.start(value,'fixture');view=finish(service,started['session_id'])
        task=view['items'][0]
        assert task['status']=='completed',task
        assert task['sources'][0]['available']
        assert len(model.requests)==3
        assert service.start(value,'fixture')==started and len(model.requests)==3
        events=service.events(started['session_id'],0)['items']
        assert [e['kind'] for e in events]==['started','tool','tool','completed']
        assert service.events(started['session_id'],events[-1]['sequence'])['items']==[]
        next_=ask(pid,'Continue',session_id=started['session_id'])
        service.start(next_,'fixture');view=finish(service,started['session_id'])
        assert len(view['items'])==2
        assert model.requests[3][1]['content']==value.question
        assert '[S1]' not in model.requests[3][2]['content']
        assert library.rows('SELECT count(*) AS n FROM notes')[0]['n']==0
        service.remove(started['session_id'],view['session']['version'])
        assert service.listing()['items']==[]
    finally:service.close()


def test_scope_change_stops_old_task_and_does_not_auto_send(library):
    doc(library);pid=profile(library);gate=Event();entered=Event();calls=[]
    def slow(*args,**kwargs):
        calls.append(1);entered.set();gate.wait(3)
        return {'role':'assistant','content':'old'},[],None
    service=Research(library,slow)
    try:
        started=service.start(ask(pid),'fixture');assert entered.wait(1)
        session=service.session(started['session_id'])
        service.edit(session['id'],SessionEdit(version=session['version'],scope={'mode':'workspace'}))
        gate.set();view=finish(service,session['id'])
        assert view['items'][0]['status']=='context_changed'
        assert len(calls)==1
    finally:gate.set();service.close()


def test_foreground_busy_and_restart_interruption(library):
    pid=profile(library);gate=Event()
    def slow(*args,**kwargs):gate.wait(2);return {'role':'assistant','content':'done'},[],None
    service=Research(library,slow)
    try:
        started=service.start(ask(pid),'fixture')
        with pytest.raises(HTTPException) as error:service.start(ask(pid),'fixture')
        assert error.value.detail=='FOREGROUND_BUSY'
        service.stop(started['task_id']);gate.set()
        assert service.view(started['session_id'])['items'][0]['status']=='cancelled'
    finally:gate.set();service.close()
    with library.db.write() as conn:conn.execute("UPDATE research_tasks SET status='running' WHERE id=?",(started['task_id'],))
    reopened=Research(library,lambda *a:pytest.fail('restart must not call model'))
    try:assert reopened.view(started['session_id'])['items'][0]['status']=='interrupted'
    finally:reopened.close()


def test_archiving_deleting_and_scope_history_do_not_dispatch(library):
    doc(library);pid=profile(library);model=Model();service=Research(library,model)
    try:
        started=service.start(ask(pid),'fixture');view=finish(service,started['session_id']);sid=started['session_id'];before=len(model.requests)
        session=service.edit(sid,SessionEdit(version=view['session']['version'],archived=True))
        with pytest.raises(HTTPException) as error:service.start(ask(pid,session_id=sid),'fixture')
        assert error.value.detail=='SESSION_ARCHIVED'
        session=service.edit(sid,SessionEdit(version=session['version'],archived=False))
        assert len(model.requests)==before
        garden=Garden(library.db);topic=garden.create(CreateTopic(id=uuid4(),title='Empty',parent_id=None))['topic']['id']
        service.edit(sid,SessionEdit(version=session['version'],scope={'mode':'topic','topic_id':topic}))
        old=service.view(sid)['items'][0]
        assert not old['sources'][0]['available']
        assert service.view(sid)['session']['scope']['topic_id']==topic
        assert len(model.requests)==before
    finally:service.close()


def test_schema25_upgrade_recovers_running_research_without_model_call(tmp_path):
    import shutil
    from pathlib import Path
    from yorw_api.storage.workspace import Workspace
    from yorw_api.storage.database import Database
    from yorw_api.library import Library
    migrations=tmp_path/'sql';migrations.mkdir()
    for p in (Path(__file__).resolve().parents[1]/'src/yorw_api/migrations').glob('*.sql'):
        if int(p.name.split('_')[0])<=25:shutil.copyfile(p,migrations/p.name)
    workspace=Workspace(tmp_path/'old');old=Database(workspace,migrations);old.close()
    db=Database(workspace);lib=Library(db)
    try:
        assert db.version==28
        assert list((workspace.root/'backups').glob('*.sqlite3'))
        service=Research(lib,lambda *a,**k:pytest.fail('migration must not call model'))
        assert service.listing()['items']==[]
        service.close()
    finally:lib.close();db.close()


def test_old_foreground_entrypoints_reject_running_research(library):
    from yorw_api.search import Search
    from yorw_api.chat import Chat,Ask as ChatAsk
    from test_search import config
    did=doc(library);pid=profile(library);gate=Event()
    def pending(*args,**kwargs):gate.wait(2);return {'role':'assistant','content':'done'},[],None
    research=Research(library,pending);search=Search(library);chat=Chat(search)
    try:
        with library.db.write() as conn:conn.execute("INSERT INTO provider_configs(kind,base_url,model,version,updated_at) VALUES('chat','https://example.com/v1','fixture',1,'time')")
        research.start(ask(pid),'fixture')
        # Gate runs before any paid document-chat stream is scheduled.
        with pytest.raises(HTTPException) as error:chat.start(did,ChatAsk(question='fixture',segment_ids=[uuid4()],config_version=1),'fixture')
        assert error.value.detail=='FOREGROUND_BUSY'
    finally:gate.set();research.close();chat.close();search.close()


def test_chinese_notes_and_topic_text_have_distinct_provenance(library):
    from io import BytesIO
    result=library.import_document(BytesIO('医疗视觉证据一致性研究。'.encode()),'owned.md');wait(library,result);did=result['document']['id']
    nid=str(uuid4())
    with library.db.write() as conn:conn.execute('INSERT INTO notes(id,document_id,body_md,created_at,updated_at) VALUES(?,?,?,?,?)',(nid,did,'医疗视觉个人假设','time','time'))
    tools=ResearchTools(library,{'mode':'workspace','topic_id':None})
    found=tools.execute('search_local',{'query':'医疗视觉'})['items']
    assert {item['kind'] for item in found}=={'document','note'}
    for item in found:
        source=tools.execute('read_local',{'handle':item['handle']})
        assert source['kind']==item['kind'] and source['document_id']==did


def test_evidence_read_waits_for_other_threads_transaction(library):
    from threading import Thread
    from yorw_api.source_status import evidence_available
    did=doc(library)
    block=library.rows('SELECT * FROM document_blocks WHERE document_id=?',(did,))[0]
    ref={'document_id':did,'block_id':block['id'],'extraction_version':block['extraction_version'],'text':block['text']}
    holding,released,finished=Event(),Event(),Event();result=[]
    def writer():
        with library.db.write() as conn:
            conn.execute('UPDATE document_blocks SET text=? WHERE id=?',('temporary in-transaction state',block['id']))
            holding.set();released.wait(2)
            conn.execute('UPDATE document_blocks SET text=? WHERE id=?',(block['text'],block['id']))
    def reader():
        result.append(evidence_available(library.db,ref));finished.set()
    first=Thread(target=writer);first.start();assert holding.wait(1)
    second=Thread(target=reader);second.start()
    try:assert not finished.wait(.05)
    finally:released.set();first.join(3);second.join(3)
    assert result==[True]
