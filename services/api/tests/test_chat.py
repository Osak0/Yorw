import json
import time
from threading import Event
import pytest
from fastapi import HTTPException
from yorw_api.chat import Chat, Ask, stream
from yorw_api.search import Search
from yorw_api.providers import ProbeError
from test_library import library
from test_search import document, upstream

@pytest.fixture
def chat(library):
    search=Search(library)
    chat=Chat(search)
    yield chat
    chat.close();search.close()

def setup(chat):
    doc=document(chat.search,['Computed tomography detects lung nodules.','Drug A lowered blood pressure.'])
    chat.search.ensure_segments(doc)
    with chat.db.write() as conn:
        conn.execute("INSERT INTO provider_configs(kind,base_url,model,version,updated_at) VALUES('chat','https://example.com/v1','fixture',1,'time')")
    ids=[row['id'] for row in chat.library.rows('SELECT id FROM search_segments WHERE document_id=? ORDER BY physical_page',(doc,))]
    return doc,Ask(question='Which imaging?',segment_ids=ids,config_version=1)

def settle(chat,item):
    for _ in range(200):
        item=chat.message(item['id'])
        if item['status']!='running': return item
        time.sleep(.01)
    pytest.fail('chat did not settle')

def test_stream_persistence_note_citations_and_scope(chat,monkeypatch):
    doc,value=setup(chat)
    def response(config,key,question,sources):
        assert key=='secret' and len(sources)==2
        yield 'Computed tomography '
        yield '[S1].'
    monkeypatch.setattr('yorw_api.chat.stream',response)
    item=settle(chat,chat.start(doc,value,'secret'))
    assert item['status']=='completed' and item['citations']==[1]
    assert item['body_md']=='Computed tomography [S1].'
    assert 'secret' not in json.dumps(item)
    note=chat.note(item['id'])
    assert chat.note(item['id'])==note
    from yorw_api.notes import Notes,NoteBody
    notes=Notes(chat.db);saved=notes._get(note['id'])
    assert saved['sources'][0]['chunk_id']==item['sources'][0]['chunk_id']
    assert '[S1]' in saved['body_md'] and 'Computed tomography' in saved['body_md']
    assert notes.update(note['id'],NoteBody(body_md='manual edit',version=1))['sources']==saved['sources']
    with chat.db.write() as conn: conn.execute('DELETE FROM chunks WHERE document_id=?',(doc,))
    assert not chat.message(item['id'])['sources'][0]['available']
    other=document(chat.search,['Other paper'])
    with pytest.raises(HTTPException):chat.start(other,value,'secret')
    assert chat.list(doc)['items'][0]['id']==item['id']

@pytest.mark.parametrize('ending',['invalid','disconnect','cancel','config','deleted','extract'])
def test_partial_and_inflight_guards(chat,monkeypatch,ending):
    doc,value=setup(chat)
    arrived,release=Event(),Event()
    def response(*args):
        yield 'partial [S1]'
        arrived.set();release.wait(3)
        if ending=='disconnect':raise ProbeError('STREAM_INTERRUPTED')
        yield ' [S999]' if ending=='invalid' else ' final'
    monkeypatch.setattr('yorw_api.chat.stream',response)
    item=chat.start(doc,value,'secret');assert arrived.wait(2)
    try:
        assert chat.message(item['id'])['body_md']=='partial [S1]'
        if ending=='cancel':chat.cancel(item['id'])
        elif ending=='config':
            with chat.db.write() as conn:conn.execute("UPDATE provider_configs SET version=2 WHERE kind='chat'")
        elif ending=='deleted':
            with chat.db.write() as conn:conn.execute("UPDATE documents SET deleted_at='time' WHERE id=?",(doc,))
        elif ending=='extract':
            with chat.db.write() as conn:conn.execute('UPDATE documents SET extraction_version=extraction_version+1 WHERE id=?',(doc,))
    finally:release.set()
    result=settle(chat,item)
    assert result['status']==('cancelled' if ending=='cancel' else 'failed')
    with pytest.raises(HTTPException):chat.note(item['id'])
    if ending in ('cancel','config','deleted','extract'):assert 'final' not in result['body_md']

def test_restart_marks_partial_interrupted(chat):
    doc,value=setup(chat)
    with chat.db.write() as conn:
        conn.execute("INSERT INTO conversations VALUES('c',?,'time')",(doc,))
        conn.execute("INSERT INTO messages(id,conversation_id,question,body_md,status,sources_json,provider_json,created_at) VALUES('m','c','q','partial','running','[]','{}','time')")
    reopened=Chat(chat.search)
    try:assert reopened.message('m')['status']=='interrupted'
    finally:reopened.close()


def test_missing_key_and_configuration_version_never_submit(chat):
    doc,value=setup(chat)
    for key,version,code in [('',1,'KEY_MISSING'),('key',2,'CONFIG_CHANGED')]:
        with pytest.raises(HTTPException) as error:chat.start(doc,value.model_copy(update={'config_version':version}),key)
        assert error.value.detail==code
    assert chat.list(doc)['items']==[]
