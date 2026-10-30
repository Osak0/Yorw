from legacy_garden import PreRemovalGarden
import json
import time
from threading import Event
from uuid import uuid4
import pytest
from fastapi import HTTPException
from yorw_api.chat import Chat
from yorw_api.garden import Garden,CreateTopic,SaveBody
from yorw_api.notes import NewNote,NoteBody
from yorw_api.search import Search
from yorw_api.suggestions import Suggestions,Material,Preview,Generate
from yorw_api.providers import ProbeError
from test_library import library
from test_search import document

@pytest.fixture
def service(library):
    search=Search(library);chat=Chat(search);suggestions=Suggestions(search,chat)
    yield suggestions
    suggestions.close();chat.close();search.close()

def setup(service):
    doc=document(service.search,['Computed tomography detects lung nodules.'])
    service.search.ensure_segments(doc)
    segment=service.library.rows('SELECT id FROM search_segments WHERE document_id=?',(doc,))[0]['id']
    topic=service.garden.create(CreateTopic(id=uuid4(),title='Medical reliability'))
    with service.db.write() as conn:conn.execute("INSERT INTO provider_configs(kind,base_url,model,version,updated_at) VALUES('chat','https://example.com/v1','fixture',1,'time')")
    material=Material(kind='document',id=doc,version='1',segment_ids=[segment])
    value=Generate(base_revision_id=topic['revision']['id'],instruction='整理事实与推断',materials=[material],request_id=uuid4(),config_version=1)
    return doc,topic['topic']['id'],value

def settle(service,item):
    for _ in range(200):
        item=service.get(item['id'])
        if item['status']!='running':return item
        time.sleep(.01)
    pytest.fail('suggestion did not settle')


def test_three_material_kinds_snapshots_and_no_automatic_overwrite(service,monkeypatch):
    doc,topic,value=setup(service)
    note=service.notes.create(NewNote(id=uuid4(),document_id=doc,body_md='用户观点：模型可能依赖文本捷径。'))
    chunk=service.library.rows('SELECT * FROM chunks WHERE document_id=?',(doc,))[0]
    mid,cid=str(uuid4()),str(uuid4())
    with service.db.write() as conn:
        conn.execute('INSERT INTO conversations VALUES(?,?,?)',(cid,doc,'time'))
        conn.execute("INSERT INTO messages(id,conversation_id,question,body_md,status,sources_json,provider_json,created_at) VALUES(?,?,?,'模型讨论 [S1]','completed',?,'{}','time')",(mid,cid,'Question',json.dumps([{'document_id':doc,'chunk_id':chunk['id'],'text':chunk['text'],'physical_page':1,'extraction_version':1}])))
    catalog=service.catalog()['items']
    mats=[value.materials[0]]+[Material(kind=c['kind'],id=c['id'],version=c['version']) for c in catalog if c['kind'] in ('note','message')]
    value=value.model_copy(update={'materials':mats})
    preview=service.preview(topic,value)
    assert [s['source_id'] for s in preview['sources']]==['S1','S2','S3']
    assert preview['sources'][1]['kind']=='note' and preview['sources'][1]['evidence']==[]
    assert preview['sources'][2]['evidence'][0]['quote']==chunk['text']
    before=service.garden.get(topic)
    sent=[]
    def response(config,key,question,sources,**options):
        sent.append((question,sources,options))
        assert key=='secret' and '个人观点' in options['system']
        yield '原文事实 [S1]；用户观点 [S2]；模型推断 [S3]。'
    monkeypatch.setattr('yorw_api.suggestions.stream',response)
    item=settle(service,service.generate(topic,value,'secret'))
    assert item['status']=='completed' and item['citations']==[1,2,3]
    assert service.garden.get(topic)==before and len(service.garden.history(topic)['items'])==1
    assert service.generate(topic,value,'secret')['id']==item['id'] and len(sent)==1
    assert 'secret' not in json.dumps(item)
    assert service.library.task(item['task_id'])['status']=='succeeded'
    assert [s['kind'] for s in sent[0][1]]==['document','note','message']
    # Subsequent edits cannot rewrite original suggestion snapshots.
    service.notes.update(note['id'],NoteBody(body_md='changed note',version=1))
    restored=service.get(item['id'])
    assert restored['sources'][1]['excerpt']=='用户观点：模型可能依赖文本捷径。'
    assert restored['sources'][1]['available'] is False

@pytest.mark.parametrize('mode',['cancel','config','delete','base','invalid','missing'])
def test_stream_races_and_invalid_citations(service,monkeypatch,mode):
    doc,topic,value=setup(service)
    arrived,release=Event(),Event()
    def response(*args,**kwargs):
        yield 'partial '
        arrived.set();release.wait(3)
        yield 'unreferenced' if mode=='missing' else '[S999]' if mode=='invalid' else '[S1]'
    monkeypatch.setattr('yorw_api.suggestions.stream',response)
    item=service.generate(topic,value,'key');assert arrived.wait(2)
    assert service.get(item['id'])['body_md']=='partial '
    try:
        if mode=='cancel':service.cancel(item['id'])
        if mode=='config':
            with service.db.write() as conn:conn.execute("UPDATE provider_configs SET version=2 WHERE kind='chat'")
        if mode=='delete':
            with service.db.write() as conn:conn.execute("UPDATE documents SET deleted_at='time' WHERE id=?",(doc,))
        if mode=='base':service.garden.save(topic,SaveBody(body_md='new manual body',base_revision_id=value.base_revision_id))
        if mode=='cancel':
            retry=service.generate(topic,value.model_copy(update={'request_id':uuid4()}),'key')
        else:
            with pytest.raises(HTTPException):service.generate(topic,value.model_copy(update={'request_id':uuid4()}),'key')
    finally:release.set()
    item=settle(service,item)
    assert item['status']==('cancelled' if mode=='cancel' else 'completed' if mode=='base' else 'failed')
    if mode=='base':assert item['stale'] and service.garden.get(topic)['revision']['body_md']=='new manual body'
    if mode in ('invalid','missing'):assert item['error_code']=='INVALID_CITATION'
    if mode=='cancel':
        assert settle(service,retry)['status']=='completed'
        assert service.get(item['id'])['body_md']=='partial '
        assert service.library.task(item['task_id'])['status']=='cancelled'


def test_preview_scope_version_limits_and_start_guards(service):
    doc,topic,value=setup(service)
    other=document(service.search,['Unselected private material'])
    service.search.ensure_segments(other)
    sid=service.library.rows('SELECT id FROM search_segments WHERE document_id=?',(other,))[0]['id']
    wrong=value.materials[0].model_copy(update={'segment_ids':[sid]})
    for materials in [[wrong],[value.materials[0],value.materials[0]],[value.materials[0].model_copy(update={'version':'stale'})]]:
        with pytest.raises(HTTPException):service.preview(topic,value.model_copy(update={'materials':materials}))
    with pytest.raises(HTTPException):service.generate(topic,value,'')
    with pytest.raises(HTTPException):service.generate(topic,value.model_copy(update={'config_version':2}),'key')
    assert service.list(topic)['items']==[]
    note=service.notes.create(NewNote(id=uuid4(),document_id=doc,body_md='x'*8001))
    with pytest.raises(HTTPException) as error:service.preview(topic,value.model_copy(update={'materials':[Material(kind='note',id=note['id'],version='1')]}))
    assert error.value.detail=='MATERIAL_TOO_LARGE_OR_EMPTY'


def test_restart_preserves_draft_and_marks_running_interrupted(service,monkeypatch):
    _,topic,value=setup(service)
    monkeypatch.setattr('yorw_api.suggestions.stream',lambda *args,**kw:iter(['draft [S1]']))
    item=settle(service,service.generate(topic,value,'key'))
    with service.db.write() as conn:
        conn.execute("UPDATE suggestions SET status='running' WHERE id=?",(item['id'],))
        conn.execute("UPDATE tasks SET status='running' WHERE id=?",(item['task_id'],))
    reopened=Suggestions(service.search,service.chat)
    try:
        restored=reopened.list(topic)['items'][0]
        assert restored['body_md']=='draft [S1]' and restored['status']=='interrupted'
        assert service.library.task(restored['task_id'])['status']=='interrupted'
    finally:reopened.close()


def test_step10_topics_and_revisions_survive_schema8_upgrade(tmp_path):
    from pathlib import Path
    import shutil
    from yorw_api.storage.database import Database
    from yorw_api.storage.workspace import Workspace
    scripts=tmp_path/'step10-migrations';scripts.mkdir()
    for file in sorted((Path(__file__).parents[1]/'src/yorw_api/migrations').glob('*.sql'))[:7]:shutil.copy2(file,scripts/file.name)
    workspace=Workspace(tmp_path/'workspace');old=Database(workspace,scripts)
    garden=PreRemovalGarden(old);first=garden.create(CreateTopic(id=uuid4(),title='Existing topic'))
    saved=garden.save(first['topic']['id'],SaveBody(body_md='Retained Wiki 正文',base_revision_id=first['revision']['id']))
    old.close();updated=Database(workspace)
    try:
        assert updated.version==23 and Garden(updated).get(first['topic']['id'])==saved
        assert updated.connection.execute('SELECT count(*) FROM suggestions').fetchone()[0]==0
        assert updated.connection.execute('PRAGMA foreign_key_check').fetchall()==[]
    finally:updated.close()


@pytest.mark.parametrize('second_ending', ['stop', 'length', 'empty', 'disconnect'])
def test_truncated_draft_continues_only_once_with_same_sources(service, monkeypatch, second_ending):
    _, topic, value = setup(service)
    calls = []
    original = service.garden.get(topic)

    def response(config, key, question, sources, **options):
        calls.append((question, sources, options))
        assert options['max_tokens'] == 8192
        assert key == 'secret'
        if len(calls) == 1:
            yield 'First part [S1].'
            options['state'].finish_reason = 'length'
            raise ProbeError('OUTPUT_TRUNCATED')
        assert options['continuation'] == 'First part [S1].'
        assert question == calls[0][0] and sources == calls[0][1]
        if second_ending != 'empty':
            yield ' Continued [S1].'
        options['state'].finish_reason = 'length' if second_ending == 'length' else 'stop'
        if second_ending == 'length':
            raise ProbeError('OUTPUT_TRUNCATED')
        if second_ending == 'disconnect':
            raise ProbeError('STREAM_INTERRUPTED')

    monkeypatch.setattr('yorw_api.suggestions.stream', response)
    item = settle(service, service.generate(topic, value, 'secret'))
    assert len(calls) == 2
    assert item['status'] == {'stop': 'completed', 'length': 'partial'}.get(second_ending, 'failed')
    assert item['body_md'] == 'First part [S1].' + ('' if second_ending == 'empty' else ' Continued [S1].')
    assert item['recoverable'] == (second_ending != 'stop')
    assert item['provider']['generation']['continuations'] == 1
    assert item['provider']['generation']['finish_reasons'][0] == 'length'
    assert service.garden.get(topic) == original
    assert service.generate(topic, value, 'secret')['id'] == item['id'] and len(calls) == 2
    assert service.library.task(item['task_id'])['status'] == ('succeeded' if second_ending == 'stop' else 'failed')
    assert 'secret' not in json.dumps(item)


@pytest.mark.parametrize('ending', ['CONTENT_FILTERED', 'UPSTREAM_RESOURCE_UNAVAILABLE',
                                   'UPSTREAM_ABORTED', 'STREAM_INTERRUPTED'])
def test_other_failures_keep_output_without_an_automatic_paid_retry(service, monkeypatch, ending):
    _, topic, value = setup(service)
    calls = []

    def response(*args, **options):
        calls.append(True)
        yield 'Saved partial [S1].'
        raise ProbeError(ending)

    monkeypatch.setattr('yorw_api.suggestions.stream', response)
    item = settle(service, service.generate(topic, value, 'secret'))
    assert item['status'] == 'failed' and item['error_code'] == ending
    assert item['recoverable'] and item['body_md'] == 'Saved partial [S1].'
    assert len(calls) == 1


@pytest.mark.parametrize('change', ['cancel', 'config', 'material'])
def test_invalidation_at_truncation_prevents_continuation(service, monkeypatch, change):
    doc, topic, value = setup(service)
    calls = []

    def response(*args, **options):
        calls.append(True)
        yield 'Saved partial [S1].'
        identity = service.list(topic)['items'][0]['id']
        if change == 'cancel':
            service.cancel(identity)
        else:
            with service.db.write() as conn:
                if change == 'config':
                    conn.execute("UPDATE provider_configs SET version=2 WHERE kind='chat'")
                else:
                    conn.execute("UPDATE documents SET deleted_at='now' WHERE id=?", (doc,))
        options['state'].finish_reason = 'length'
        raise ProbeError('OUTPUT_TRUNCATED')

    monkeypatch.setattr('yorw_api.suggestions.stream', response)
    item = settle(service, service.generate(topic, value, 'secret'))
    assert len(calls) == 1 and item['status'] == ('cancelled' if change == 'cancel' else 'failed')
    assert item['body_md'] == 'Saved partial [S1].'


def test_queued_cancel_before_worker_starts_does_not_leave_a_running_task(service, monkeypatch):
    _, topic, value = setup(service)
    jobs = []
    monkeypatch.setattr(service.pool, 'submit', lambda *args: jobs.append(args))
    item = service.generate(topic, value, 'secret')
    service.cancel(item['id'])
    function, *args = jobs[0]
    function(*args)
    result = service.get(item['id'])
    assert result['status'] == 'cancelled' and not result['recoverable']
    assert service.library.task(item['task_id'])['status'] == 'cancelled'
