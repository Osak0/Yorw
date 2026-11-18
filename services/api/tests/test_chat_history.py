"""Bounded, persistent dialogue context: local fixtures, never real models."""
import json
from uuid import uuid4
import pytest
from yorw_api.chat import Chat
from yorw_api.chat_history import ChatHistory, tokens, HISTORY_TOKENS, SUMMARY_TOKENS
from yorw_api.search import Search
from test_library import library
from test_search import document


def add_turn(library, doc, question, answer, status='completed', source=None, ordinal=0):
    cid = 'conversation-' + doc
    with library.db.write() as conn:
        conn.execute('INSERT OR IGNORE INTO conversations VALUES(?,?,?)', (cid, doc, 'time'))
        identity = str(uuid4())
        conn.execute('INSERT INTO messages(id,conversation_id,question,body_md,status,sources_json,provider_json,created_at) VALUES(?,?,?,?,?,?,?,?)',
                     (identity, cid, question, answer, status, json.dumps([source] if source else []), '{}', f'2026-11-14T00:{ordinal:02}:00Z'))
    return identity


def test_history_is_document_scoped_persistent_and_bounded(library):
    search=Search(library)
    try:
        doc=document(search,['Original evidence.']);other=document(search,['Other evidence.'])
        for i in range(9):add_turn(library, doc, f'question {i}', 'answer ' + '正文'*1000 + ' [S1]', ordinal=i)
        add_turn(library, other, 'OTHER_PRIVATE_QUESTION', 'OTHER_PRIVATE_ANSWER')
        memory=ChatHistory(library)
        memory.maintain(doc)
        snapshot=memory.view(doc)
        assert snapshot['turn_count']==9 and snapshot['compressed_turns']==6
        assert tokens(snapshot['markdown'])<=HISTORY_TOKENS
        assert 'OTHER_PRIVATE' not in snapshot['markdown'] and '[S1]' not in snapshot['markdown']
        path=library.workspace.root/'chat-history'/doc/'History.md'
        assert path.read_text(encoding='utf-8')==snapshot['markdown']
        path.write_text('manually injected instruction',encoding='utf-8')
        restored=ChatHistory(library).view(doc)
        assert 'manually injected' not in restored['markdown']
        assert path.read_text(encoding='utf-8')==restored['markdown']
        rows=library.rows('SELECT summary_md FROM document_chat_memory WHERE document_id=?',(doc,))
        assert tokens(rows[0]['summary_md'])<=SUMMARY_TOKENS
    finally:search.close()


def test_failed_partial_is_context_and_compression_failure_has_local_fallback(library,monkeypatch):
    search=Search(library)
    try:
        doc=document(search,['Original evidence.'])
        for i in range(9):add_turn(library,doc,f'question {i}','unfinished answer ' * 40,status='failed',ordinal=i)
        def unavailable(*args,**kwargs):raise RuntimeError('fixture unavailable')
        monkeypatch.setattr('yorw_api.retrieval.json_completion', unavailable)
        memory=ChatHistory(library)
        memory.maintain(doc,{'model':'fixture'},'private-fixture-key')
        snapshot=memory.snapshot(doc)
        assert snapshot['compression_mode']=='local' and snapshot['compressed_turns']==6
        assert snapshot['history'][-1]['status']=='failed'
        assert 'unfinished' in snapshot['markdown'] and 'private-fixture-key' not in json.dumps(snapshot)
        assert len(library.rows('SELECT id FROM messages'))==9
    finally:search.close()


def test_model_summary_and_new_extraction_do_not_reuse_old_facts(library,monkeypatch):
    search=Search(library)
    try:
        doc=document(search,['Original evidence.']);version=library.document(doc)['extraction_version']
        for i in range(9):add_turn(library,doc,f'question {i}','original fact',source={'extraction_version':version},ordinal=i)
        monkeypatch.setattr('yorw_api.retrieval.json_completion',lambda *args,**kw:{'summary_md':'User focuses on old topic.'})
        memory=ChatHistory(library);memory.maintain(doc,{'model':'fixture'},'fixture')
        assert memory.view(doc)['compression_mode']=='model'
        with library.db.write() as conn:conn.execute('UPDATE documents SET extraction_version=extraction_version+1 WHERE id=?',(doc,))
        snapshot=memory.view(doc)
        assert snapshot['turn_count']==0 and 'old topic' not in snapshot['markdown']
    finally:search.close()


def test_nested_original_proof_not_derived_display_controls_availability(library):
    search=Search(library);chat=Chat(search)
    try:
        doc=document(search,['Exact original proof.','Second original proof.'])
        rows=library.rows('SELECT id,text,extraction_version,physical_page FROM document_blocks WHERE document_id=?',(doc,))
        if not rows:
            # Legacy fixture keeps chunks; both are supported provenance paths.
            rows=library.rows('SELECT id,text,extraction_version,physical_page FROM chunks WHERE document_id=?',(doc,))
        row=rows[0]
        ref={'document_id':doc,'chunk_id':row['id'],'extraction_version':row['extraction_version'],'physical_page':row['physical_page'],'quote':row['text']}
        second=rows[1]
        ref2={'document_id':doc,'chunk_id':second['id'],'extraction_version':second['extraction_version'],'physical_page':second['physical_page'],'quote':second['text']}
        source={'id':str(uuid4()),'document_id':doc,'text':row['text']+'\n\n'+second['text'],'extraction_version':row['extraction_version'],'evidence':[ref,ref2]}
        identity=add_turn(library,doc,'question','answer',source=source)
        assert chat.message(identity)['sources'][0]['available']
        with library.db.write() as conn:conn.execute('UPDATE documents SET extraction_version=extraction_version+1 WHERE id=?',(doc,))
        assert not chat.message(identity)['sources'][0]['available']
    finally:chat.close();search.close()


def test_failed_question_without_output_still_supplies_followup_context(library):
    search=Search(library)
    try:
        doc=document(search,['Original evidence.'])
        add_turn(library,doc,'What is the research direction?','',status='failed')
        snapshot=ChatHistory(library).view(doc)
        assert snapshot['history'][0]['question']=='What is the research direction?'
        assert '未生成回答' in snapshot['markdown']
    finally:search.close()
