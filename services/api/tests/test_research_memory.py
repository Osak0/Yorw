import json
import time
from threading import Event
from uuid import uuid4
import pytest
from fastapi import HTTPException
from test_library import library
from test_research import doc,profile,Model,ask,finish
from yorw_api.research import Research
from yorw_api.research_memory import ResearchMemory,Edit,Preferences,MEMORY_BUDGET
from yorw_api.garden import Garden,CreateTopic
from yorw_api.providers import ProbeError
from yorw_api.chat_history import tokens


def setup(library):
    memory=ResearchMemory(library)
    topic=Garden(library.db).create(CreateTopic(id=uuid4(),title='Evidence research',parent_id=None))['topic']['id']
    memory.state(topic)
    return memory,topic


def activity(memory,topic,question='Discuss experiment; not completed'):
    identity=str(uuid4())
    with memory.db.write() as conn:
        cur=conn.execute('INSERT INTO research_activity(event_key,kind,object_id,object_version,topic_id,summary,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)',(identity,'owned_fixture',identity,'1',topic,question,json.dumps({'question':question}),'time'))
        return cur.lastrowid


def prefs(memory,**values):
    return memory.save_prefs(Preferences(**{**memory.prefs(),**values}))


def test_transactional_journal_terminal_events_and_deduplication(library):
    memory,topic=setup(library);did=doc(library)
    pid=profile(library);service=Research(library,Model(),memory)
    result=service.start(ask(pid),'owned-fixture');finish(service,result['session_id'])
    events=memory.rows("SELECT * FROM research_activity WHERE kind='research'")
    assert len(events)==1 and json.loads(events[0]['payload_json'])['question']
    with library.db.write() as conn:
        conn.execute("UPDATE research_tasks SET body_md=body_md||'tail' WHERE id=?",(result['task_id'],))
    assert len(memory.rows("SELECT * FROM research_activity WHERE kind='research'"))==1
    count=len(memory.rows('SELECT * FROM research_activity'))
    with pytest.raises(RuntimeError):
        with library.db.write() as conn:
            conn.execute('UPDATE documents SET version=version+1 WHERE id=?',(did,));raise RuntimeError()
    assert len(memory.rows('SELECT * FROM research_activity'))==count
    service.close();memory.close()


def test_guide_versions_conflict_restore_and_export_not_input(library):
    memory,topic=setup(library)
    first=memory.edit(topic,Edit(version=1,guide='Prefer controlled experiments'))
    second=memory.edit(topic,Edit(version=2,guide='Prefer reliable baselines'))
    with pytest.raises(HTTPException) as error:memory.edit(topic,Edit(version=1,guide='stale'))
    assert error.value.status_code==409
    restored=memory.edit(topic,Edit(version=3,action='restore',restore_version=second['versions'][0]['id']))
    assert restored['guide']==first['guide']
    memory.export(topic)
    path=library.workspace.root/'research'/'topics'/topic/'Research.md'
    assert 'controlled' in path.read_text(encoding='utf-8')
    path.write_text('EXTERNAL INSTRUCTION',encoding='utf-8')
    context,_=memory.context({'mode':'topic','topic_id':topic},'experiments')
    assert 'EXTERNAL' not in json.dumps(context)
    memory.close()


def test_forget_blocks_recompression_and_history_without_deleting_journal(library):
    memory,topic=setup(library);prefs(memory,event_threshold=1)
    identity=activity(memory,topic)
    memory.local_maintain(topic);view=memory.view(topic)
    entry=next(e for e in view['entries'] if identity in e['event_ids'])
    assert entry['progress']['status']!='completed'
    memory.edit(topic,Edit(version=1,entry_id=entry['id'],action='forget'))
    assert identity not in [e['id'] for e in memory.activity(topic)]
    assert identity in [e['id'] for e in memory.journal(topic)]
    activity(memory,topic,'A different question');memory.local_maintain(topic)
    assert 'not completed' not in json.dumps(memory.entries(topic))
    memory.edit(topic,Edit(version=2,entry_id=entry['id'],action='reintroduce'))
    assert identity in [e['id'] for e in memory.activity(topic)]
    memory.close()


def test_scope_and_changed_sources_exclude_mixed_summary(library):
    memory,topic=setup(library);did=doc(library)
    with library.db.write() as conn:conn.execute('INSERT INTO document_topics(document_id,topic_id,created_at) VALUES(?,?,?)',(did,topic,'time'))
    event=next(e for e in memory.activity(topic) if e['kind']=='document')
    memory.commit_summary(topic,[event],[{'text':'Mixed context','certainty':'candidate','event_ids':[event['id']]}],1,'local')
    assert memory.entries(topic)
    other=Garden(library.db).create(CreateTopic(id=uuid4(),title='Other',parent_id=None))['topic']['id']
    assert memory.entries(topic,{'mode':'topic','topic_id':other})==[]
    with library.db.write() as conn:conn.execute('UPDATE documents SET extraction_version=extraction_version+1 WHERE id=?',(did,))
    assert memory.entries(topic)==[]
    assert not memory.commit_summary(topic,[event],[{'text':'stale','certainty':'candidate','event_ids':[event['id']]}],1,'model')
    memory.close()


def test_global_index_no_topic_conclusions_and_conservative_budget(library):
    memory,topic=setup(library);prefs(memory,event_threshold=1)
    activity(memory,topic,'Sensitive hypothesis is true?')
    memory.local_maintain('global')
    assert 'Sensitive' not in json.dumps(memory.entries('global'))
    memory.edit(topic,Edit(version=1,guide='x'*5000))
    with pytest.raises(ProbeError) as error:memory.context({'mode':'topic','topic_id':topic},'hello')
    assert error.value.code=='GUIDE_TOO_LONG'
    memory.edit(topic,Edit(version=2,guide='brief'))
    for i in range(30):activity(memory,topic,'question '+str(i))
    memory.local_maintain(topic)
    value,_=memory.context({'mode':'topic','topic_id':topic},'question')
    assert tokens(json.dumps(value,ensure_ascii=False))<=MEMORY_BUDGET
    memory.close()


def test_disabled_no_model_daily_cap_and_restart_cooldown(library,monkeypatch):
    memory,topic=setup(library);pid=profile(library);prefs(memory,event_threshold=1,daily_limit=0)
    activity(memory,topic)
    assert memory.pending()['items']==[] and memory.entries(topic)
    prefs(memory,enabled=False);activity(memory,topic,'new question')
    before=memory.state(topic)['summary_version'];assert memory.pending()['items']==[]
    assert memory.state(topic)['summary_version']==before
    prefs(memory,enabled=True,daily_limit=2)
    monkeypatch.setattr('yorw_api.research_memory._stream_turn',lambda *a,**kw:(_ for _ in ()).throw(RuntimeError('owned failure')))
    assert memory.compress(topic,pid,1,'owned-key')['started']
    memory.worker.join(3)
    assert memory.state(topic)['mode']=='local'
    calls=memory.rows('SELECT calls FROM research_memory_usage')[0]['calls'];assert calls==1
    activity(memory,topic,'next question');memory.close()
    restarted=ResearchMemory(library)
    assert restarted.pending()['items']==[]
    assert restarted.rows('SELECT calls FROM research_memory_usage')[0]['calls']==calls
    restarted.close()


def test_background_stale_write_rejected_user_correction_invalidates_task(library,monkeypatch):
    memory,topic=setup(library);prefs(memory,event_threshold=1)
    identity=activity(memory,topic);pid=profile(library)
    started=Event();release=Event()
    def summarize(*args,**kw):
        started.set();assert release.wait(4)
        return {'content':json.dumps({'entries':[{'text':'stale old summary','event_ids':[identity]}]})},[],None
    monkeypatch.setattr('yorw_api.research_memory._stream_turn',summarize)
    memory.compress(topic,pid,1,'owned-key');assert started.wait(2)
    memory.edit(topic,Edit(version=1,guide='User correction wins'))
    release.set();memory.worker.join(3)
    assert not memory.entries(topic) and memory.state(topic)['user_guide']=='User correction wins'
    # Summary version updates are distinct from explicit content versions.
    before=memory.state(topic)['content_version'];memory.local_maintain(topic)
    assert memory.state(topic)['content_version']==before
    memory.close()


def test_new_session_receives_memory_order_and_forget_excludes_history(library):
    memory,topic=setup(library);doc(library);pid=profile(library);model=Model();service=Research(library,model,memory)
    memory.edit('global',Edit(version=1,guide='Discuss minimal controls'))
    first=service.start(ask(pid),'owned');finish(service,first['session_id'])
    memory.edit('global',Edit(version=2,action='forget',source_kind='research',source_id=first['task_id']))
    assert not memory.history_allowed(first['task_id'],first['session_id'])
    second=service.start(ask(pid,question='Explain fixture again'),'owned');finish(service,second['session_id'])
    messages=model.requests[-3]
    assert messages[0]['role']=='system' and 'minimal controls' in messages[1]['content']
    assert messages[2]['role']=='user' and '历史背景' in messages[2]['content']
    assert messages[-1]['content']=='Explain fixture again'
    assert first['session_id']!=second['session_id']
    service.close();memory.close()


def test_invalid_key_and_export_symlink_rejected(library,monkeypatch):
    memory,topic=setup(library)
    with pytest.raises(HTTPException):memory.view('../outside')
    root=library.workspace.root/'research';root.mkdir()
    other=library.workspace.root/'elsewhere';other.mkdir()
    try:(root/'Research.md').symlink_to(other/'bad.md')
    except OSError:
        # Exercise the link guard even on Windows without symlink privileges.
        from pathlib import Path
        actual=Path.is_symlink
        monkeypatch.setattr(Path,'is_symlink',lambda path:path==root/'Research.md' or actual(path))
    with pytest.raises(ValueError):memory.export('global')
    assert not (other/'bad.md').exists()
    memory.close()


def test_background_compression_does_not_block_foreground_and_correction_stops_it(library,monkeypatch):
    memory,topic=setup(library);prefs(memory,event_threshold=1);doc(library);pid=profile(library)
    identity=activity(memory,topic);summary_started=Event();summary_release=Event();foreground_started=Event();foreground_release=Event()
    def summarize(*args,**kwargs):
        summary_started.set();assert summary_release.wait(4)
        return {'content':json.dumps({'entries':[{'text':'Candidate experiment','event_ids':[identity]}]})},[],None
    monkeypatch.setattr('yorw_api.research_memory._stream_turn',summarize)
    memory.compress(topic,pid,1,'owned');assert summary_started.wait(2)
    base=Model()
    def foreground(*args,**kwargs):
        if not foreground_started.is_set():
            foreground_started.set();assert foreground_release.wait(4)
        return base(*args,**kwargs)
    service=Research(library,foreground,memory)
    task=service.start(ask(pid,scope={'mode':'topic','topic_id':topic}),'owned')
    assert foreground_started.wait(2)
    summary_release.set();memory.worker.join(3)
    assert memory.state(topic)['summary_version']==1
    assert service.view(task['session_id'])['items'][0]['status']=='running'
    memory.edit(topic,Edit(version=1,guide='Corrected plan'))
    assert service.stops[task['task_id']].is_set()
    foreground_release.set();view=finish(service,task['session_id'])
    assert view['items'][0]['error_code']=='MEMORY_CHANGED'
    assert len(base.requests)==1 # no subsequent tool or paid model turn after correction
    service.close();memory.close()


def test_schema26_upgrade_backfills_once_with_backup(tmp_path):
    import shutil
    from pathlib import Path
    from yorw_api.storage.workspace import Workspace
    from yorw_api.storage.database import Database
    from yorw_api.library import Library
    migrations=tmp_path/'sql';migrations.mkdir()
    for path in (Path(__file__).resolve().parents[1]/'src/yorw_api/migrations').glob('*.sql'):
        if int(path.name.split('_')[0])<=26:shutil.copyfile(path,migrations/path.name)
    workspace=Workspace(tmp_path/'old');db=Database(workspace,migrations);old=Library(db)
    did=doc(old);old.close();db.close()
    for _ in range(2):
        db=Database(workspace);lib=Library(db);memory=ResearchMemory(lib)
        assert db.version==28
        assert len(memory.rows("SELECT id FROM research_activity WHERE event_key LIKE 'snapshot-document:%' AND document_id=?",(did,)))==1
        assert list((workspace.root/'backups').glob('*.sqlite3'))
        memory.close();lib.close();db.close()


def test_summary_fallback_preserves_old_context_and_pinned_budget_is_explicit(library):
    memory,topic=setup(library);prefs(memory,event_threshold=1)
    activity(memory,topic,'First hypothesis');memory.local_maintain(topic)
    activity(memory,topic,'Second hypothesis');memory.local_maintain(topic)
    assert 'First hypothesis' in json.dumps(memory.entries(topic))
    memory.edit(topic,Edit(version=1,text='z'*5000))
    with pytest.raises(ProbeError) as error:memory.context({'mode':'topic','topic_id':topic},'First')
    assert error.value.code=='GUIDE_TOO_LONG'
    memory.close()


def test_forgotten_direction_index_not_recreated_by_maintenance(library):
    memory,topic=setup(library);prefs(memory,event_threshold=1)
    activity(memory,topic);memory.local_maintain('global')
    entry=memory.entries('global')[0]
    memory.edit('global',Edit(version=1,entry_id=entry['id'],action='forget'))
    activity(memory,topic,'New activity');memory.local_maintain('global')
    assert not memory.entries('global')
    memory.edit('global',Edit(version=2,entry_id=entry['id'],action='reintroduce'))
    assert memory.entries('global')
    memory.close()


def test_six_completed_dialogues_trigger_summary_not_streaming_or_failure(library):
    memory,topic=setup(library);pid=profile(library)
    def discuss(config,key,messages,*args,**kwargs):
        if messages[-1]['content']=='Failure fixture':raise ProbeError('TIMEOUT')
        return {'role':'assistant','content':'Candidate idea, not a result.'},[],None
    service=Research(library,discuss,memory)
    failed=service.start(ask(pid,question='Failure fixture',scope={'mode':'topic','topic_id':topic}),'owned')
    assert finish(service,failed['session_id'])['items'][0]['status']=='failed'
    assert not memory.due(topic)[0]
    for index in range(6):
        task=service.start(ask(pid,question='Idea',scope={'mode':'topic','topic_id':topic}),'owned')
        assert finish(service,task['session_id'])['items'][0]['status']=='completed'
        assert memory.due(topic)[0]==(index==5)
    service.close();memory.close()


def test_long_guide_rejects_new_request_but_idempotent_retry_returns_old_task(library):
    memory,topic=setup(library);doc(library);pid=profile(library);service=Research(library,Model(),memory)
    value=ask(pid);first=service.start(value,'owned');finish(service,first['session_id'])
    memory.edit('global',Edit(version=1,guide='z'*5000))
    assert service.start(value,'owned')==first
    with pytest.raises(HTTPException) as error:service.start(ask(pid),'owned')
    assert error.value.detail=='GUIDE_TOO_LONG'
    assert len(service.listing()['items'])==1
    service.close();memory.close()
