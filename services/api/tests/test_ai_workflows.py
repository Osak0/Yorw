"""Workflow control and provenance tests, not model-quality benchmarks."""
import json
import time
from threading import Event
from uuid import uuid4

import pytest
from fastapi import HTTPException

from yorw_api.ai_workflows import Workflows, WorkflowInput, Preferences
from yorw_api.garden import CreateTopic, SaveBody
from yorw_api.notes import NewNote, NoteBody
from yorw_api.providers import ProbeError
from yorw_api.retrieval import spans, excerpt, query_terms
from yorw_api.wiki_review import WikiReview, Accept, Decision
from test_library import library
from test_suggestions import service, setup
from test_search import document, config, toy_embed


@pytest.fixture
def workflow(service):
    value = Workflows(service)
    yield value
    value.close()


def settle(workflow, task):
    for _ in range(400):
        result = workflow.get(task['id'])
        if result['status'] not in ('queued', 'running'):
            return result
        time.sleep(.01)
    pytest.fail('workflow did not finish')


def local(workflow):
    prefs = workflow.preferences()
    return workflow.save_preferences(Preferences(semantic_enabled=False, version=prefs['version']))


def run(workflow, kind, target, text, base=None, **keys):
    value = WorkflowInput(kind=kind, target_id=target, text=text, base_revision_id=base, request_id=uuid4())
    return value, settle(workflow, workflow.start(value, **keys))


def test_local_search_one_submit_short_original_snippet_and_scope(workflow):
    local(workflow)
    current = document(workflow.suggestions.search, ['Preface. ' + 'Unrelated background. ' * 60 + '\n\nRegistration allows individual applicants and teams of three.\n\n' + 'Closing note. ' * 50])
    document(workflow.suggestions.search, ['Private distractor: registration allows 500 people.'])
    value, result = run(workflow, 'search', current, 'registration teams')
    assert result['status'] == 'succeeded', result
    assert 1 <= len(result['result']['items']) <= 5
    for hit in result['result']['items']:
        assert len(hit['snippet']) <= 220 and hit['document_id'] == current
        assert 'text' not in hit and 'source' not in hit
        assert hit['snippet'] in ''.join(row['text'] for row in workflow.library.rows('SELECT text FROM chunks WHERE document_id=?', (current,)))
    assert workflow.start(value)['id'] == result['id']
    with pytest.raises(HTTPException):
        workflow.start(value.model_copy(update={'text': 'changed'}))


def test_segment_and_excerpt_offsets_remain_original():
    text = ('段落背景与研究条件。\n\n' * 100) + '核心发现：模型依赖视觉证据。' + (' Extended context.' * 200)
    pieces = list(spans(text))
    assert len(pieces) > 2 and all(0 < b-a <= 800 for a,b in pieces)
    assert pieces[0][0] == 0 and pieces[-1][1] == len(text)
    assert all(pieces[i+1][0] <= pieces[i][1] for i in range(len(pieces)-1))
    snippet = excerpt(text, '视觉证据')
    assert snippet['snippet'] == text[snippet['snippet_start']:snippet['snippet_end']]
    assert '视觉证据' in snippet['snippet'] and len(snippet['snippet']) <= 220
    assert not set(query_terms('请问哪些的什么吗'))


def test_automatic_vectors_reuse_cache_and_filtering_can_return_no_results(workflow, monkeypatch):
    doc, _, _ = setup(workflow.suggestions)
    config(workflow.suggestions.search)
    calls = []
    def embedding(cfg, key, texts, dimension=None):
        calls.append(list(texts))
        return toy_embed(cfg, key, texts, dimension)
    monkeypatch.setattr('yorw_api.retrieval.embed', embedding)
    monkeypatch.setattr('yorw_api.retrieval.json_completion', lambda *a, **k: {'items': []})
    for _ in range(2):
        _, result = run(workflow, 'search', doc, 'lung', chat_key='chat-secret', embedding_key='embed-secret', chat_version=1, embedding_version=1)
        assert result['status'] == 'succeeded' and result['result']['items'] == []
        assert result['result']['filtered'] is True
    assert len(calls) == 3  # one build, two query embeddings
    assert 'secret' not in json.dumps(result)
    vectors = workflow.library.rows('SELECT * FROM knowledge_vectors')
    assert vectors
    with workflow.db.write() as conn:
        conn.execute("UPDATE documents SET deleted_at='now' WHERE id=?", (doc,))
    workflow.retriever.prepare(None, None, lambda phase: None)
    assert not workflow.library.rows('SELECT * FROM knowledge_vectors')


def test_disabled_semantic_never_calls_embedding_or_model_filter(workflow, monkeypatch):
    doc, _, _ = setup(workflow.suggestions)
    config(workflow.suggestions.search)
    local(workflow)
    def forbidden(*a, **k):
        pytest.fail('semantic disabled: retrieval must be local')
    monkeypatch.setattr('yorw_api.retrieval.embed', forbidden)
    monkeypatch.setattr('yorw_api.retrieval.json_completion', forbidden)
    _, task = run(workflow, 'search', doc, 'lung', chat_version=1, embedding_version=1)
    assert task['status'] == 'succeeded' and task['result']['items']


def test_whole_workspace_includes_notes_and_wiki_and_updates_versions(workflow):
    doc = document(workflow.suggestions.search, ['Original evidence about lung nodules.'])
    note = workflow.suggestions.notes.create(NewNote(id=uuid4(), document_id=doc, body_md='My hypothesis about lung nodules.'))
    topic = workflow.suggestions.garden.create(CreateTopic(id=uuid4(), title='Independent synthesis'))
    saved = workflow.suggestions.garden.save(topic['topic']['id'], SaveBody(base_revision_id=topic['revision']['id'], body_md='My Wiki on lung nodules.'))
    rows = workflow.retriever.prepare(None, None, lambda phase: None)
    assert {row['kind'] for row in rows} == {'document', 'note', 'wiki'}
    assert all(workflow.retriever.available(row['source'])['available'] for row in rows)
    selected = [row for row in rows if row['kind'] == 'wiki'][0]
    workflow.suggestions.garden.save(topic['topic']['id'], SaveBody(base_revision_id=saved['revision']['id'], body_md='Updated knowledge.'))
    assert not workflow.retriever.available(selected['source'])['available']
    excluded = workflow.retriever.prepare(None, topic['topic']['id'], lambda phase: None)
    assert all(row['kind'] != 'wiki' for row in excluded)
    workflow.suggestions.notes.update(note['id'], NoteBody(body_md='Changed opinion', version=1))
    old_note = [row for row in rows if row['kind'] == 'note'][0]
    assert not workflow.retriever.available(old_note['source'])['available']


def test_chat_automatically_finds_evidence_and_resolves_followup(workflow, monkeypatch):
    doc, _, _ = setup(workflow.suggestions)
    local(workflow)
    asked, rewritten = [], []
    def response(cfg, key, question, sources):
        asked.append((question, sources))
        yield 'Computed tomography [S1].'
    monkeypatch.setattr('yorw_api.chat.stream', response)
    def rewrite(cfg, key, instruction, body, **options):
        rewritten.append(body)
        return {'query': 'computed tomography lung'}
    monkeypatch.setattr('yorw_api.ai_workflows.json_completion', rewrite)
    first, task = run(workflow, 'chat', doc, 'lung imaging?', chat_key='secret', chat_version=1)
    assert task['status'] == 'succeeded', task
    for _ in range(200):
        if workflow.chat.message(task['result']['message_id'])['status'] != 'running': break
        time.sleep(.01)
    _, followup = run(workflow, 'chat', doc, '它使用什么？', chat_key='secret', chat_version=1)
    assert followup['status'] == 'succeeded', followup
    for _ in range(200):
        message = workflow.chat.message(followup['result']['message_id'])
        if message['status'] != 'running': break
        time.sleep(.01)
    assert rewritten[0]['history'][0]['question'] == first.text
    assert json.loads(asked[-1][0])['recent_dialogue_for_context_only'][0]['question'] == first.text
    assert all(source['document_id'] == doc for source in asked[-1][1])
    assert workflow.start(first, chat_key='secret', chat_version=1)['id'] == task['id']


def test_auto_draft_can_append_with_renumbered_citations_and_restore(workflow, monkeypatch):
    doc, target, _ = setup(workflow.suggestions)
    local(workflow)
    monkeypatch.setattr('yorw_api.suggestions.stream', lambda *a, **k: iter(['Original lung fact [S1].']))
    base = workflow.suggestions.garden.get(target)['revision']['id']
    _, task = run(workflow, 'draft', target, 'lung evidence', base, chat_key='secret', chat_version=1)
    assert task['status'] == 'succeeded', task
    sid = task['result']['suggestion_id']
    for _ in range(200):
        draft = workflow.suggestions.get(sid)
        if draft['status'] != 'running': break
        time.sleep(.01)
    assert draft['status'] == 'completed'
    review = WikiReview(workflow.suggestions)
    accepted = review.decide(sid, Accept(request_id=uuid4(), base_revision_id=base, body_md='First [S1].'), True)['view']
    _, task2 = run(workflow, 'draft', target, 'lung evidence', accepted['revision']['id'], chat_key='secret', chat_version=1)
    assert task2['status'] == 'succeeded', task2
    sid2 = task2['result']['suggestion_id']
    for _ in range(200):
        if workflow.suggestions.get(sid2)['status'] != 'running': break
        time.sleep(.01)
    args = Accept(request_id=uuid4(), base_revision_id=accepted['revision']['id'], body_md='Added [S1].', apply_mode='append')
    merged = review.decide(sid2, args, True)['view']
    assert merged['revision']['body_md'] == 'First [S1].\n\nAdded [S2].'
    assert [source['source_id'] for source in merged['revision']['sources']] == ['S1', 'S2']
    assert review.decide(sid2, args, True)['view'] == merged
    restored = review.restore(target, accepted['revision']['id'], Decision(request_id=uuid4(), base_revision_id=merged['revision']['id']))
    assert restored['view']['revision']['body_md'] == 'First [S1].'


@pytest.mark.parametrize('change', ['cancel', 'config', 'preference', 'source'])
def test_inflight_index_checks_cancellation_and_versions_before_publication(workflow, monkeypatch, change):
    doc, _, _ = setup(workflow.suggestions)
    config(workflow.suggestions.search)
    arrived, release = Event(), Event()
    calls = []
    def embedding(cfg, key, texts, dimension=None):
        calls.append(texts)
        arrived.set()
        assert release.wait(3)
        return toy_embed(cfg, key, texts, dimension)
    monkeypatch.setattr('yorw_api.retrieval.embed', embedding)
    value = WorkflowInput(kind='search', target_id=doc, text='lung', request_id=uuid4())
    task = workflow.start(value, chat_key='chat-secret', embedding_key='embedding-secret', chat_version=1, embedding_version=1)
    assert arrived.wait(2)
    try:
        if change == 'cancel':
            workflow.cancel(task['id'])
        elif change == 'preference':
            workflow.save_preferences(Preferences(semantic_enabled=False, version=1))
        else:
            with workflow.db.write() as conn:
                if change == 'config':
                    conn.execute("UPDATE provider_configs SET version=2 WHERE kind='embedding'")
                else:
                    conn.execute("UPDATE documents SET deleted_at='now' WHERE id=?", (doc,))
    finally:
        release.set()
    result = settle(workflow, task)
    assert result['status'] == ('cancelled' if change == 'cancel' else 'failed')
    workflow.pool.submit(lambda: None).result(timeout=3)  # wait for worker cleanup
    assert not workflow.library.rows('SELECT * FROM knowledge_vectors')
    assert len(calls) == 1


def test_invalid_model_selection_cannot_invent_a_source(workflow, monkeypatch):
    doc, _, _ = setup(workflow.suggestions)
    monkeypatch.setattr('yorw_api.retrieval.json_completion', lambda *a, **k: {'items': [{'id': 'invented', 'sentence': 0}]})
    _, result = run(workflow, 'search', doc, 'lung', chat_key='secret', chat_version=1)
    assert result['status'] == 'succeeded'
    assert result['result']['filtered'] is False and result['result']['items']
    assert all(row['document_id'] == doc and row['id'] != 'invented' for row in result['result']['items'])


def test_no_evidence_does_not_generate_unfounded_draft(workflow, monkeypatch):
    _, topic, _ = setup(workflow.suggestions)
    local(workflow)
    def forbidden(*a, **k):
        pytest.fail('no evidence: never generate a Wiki draft')
    monkeypatch.setattr('yorw_api.suggestions.stream', forbidden)
    base = workflow.suggestions.garden.get(topic)['revision']['id']
    _, result = run(workflow, 'draft', topic, 'orbital astrophysics', base, chat_key='secret', chat_version=1)
    assert result['status'] == 'failed' and result['error']['code'] == 'NO_EVIDENCE'
    assert workflow.suggestions.list(topic)['items'] == []


def test_schema9_upgrade_and_preferences_preserve_research_assets(tmp_path):
    from pathlib import Path
    import shutil
    from yorw_api.storage.database import Database
    from yorw_api.storage.workspace import Workspace
    from yorw_api.garden import Garden
    scripts = tmp_path/'schema9'
    scripts.mkdir()
    for path in sorted((Path(__file__).parents[1]/'src/yorw_api/migrations').glob('*.sql'))[:9]:
        shutil.copy2(path, scripts/path.name)
    workspace = Workspace(tmp_path/'workspace')
    old = Database(workspace, scripts)
    topic = Garden(old).create(CreateTopic(id=uuid4(), title='Retained research'))
    saved = Garden(old).save(topic['topic']['id'], SaveBody(base_revision_id=topic['revision']['id'], body_md='Original saved synthesis'))
    old.close()
    upgraded = Database(workspace)
    try:
        assert upgraded.version == 11
        assert Garden(upgraded).get(topic['topic']['id']) == saved
        assert upgraded.connection.execute('SELECT semantic_enabled,version FROM ai_preferences').fetchone() == (1, 1)
        assert len(list((workspace.root/'backups').glob('*.sqlite3'))) == 1
        assert upgraded.connection.execute('PRAGMA foreign_key_check').fetchall() == []
        assert upgraded.connection.execute('SELECT count(*) FROM knowledge_segments').fetchone() == (0,)
    finally:
        upgraded.close()


def test_long_saved_wiki_is_automatically_bounded_without_changing_its_base(workflow, monkeypatch):
    _, topic, _ = setup(workflow.suggestions)
    local(workflow)
    original = workflow.suggestions.garden.get(topic)['revision']
    long_body = 'Earlier background.\n' * 3000 + 'Important lung evidence at the end.'
    saved = workflow.suggestions.garden.save(topic, SaveBody(base_revision_id=original['id'], body_md=long_body))
    prompts = []
    def response(cfg, key, question, sources, **options):
        prompts.append(json.loads(question))
        yield 'Lung fact [S1].'
    monkeypatch.setattr('yorw_api.suggestions.stream', response)
    _, task = run(workflow, 'draft', topic, 'lung evidence', saved['revision']['id'], chat_key='secret', chat_version=1)
    assert task['status'] == 'succeeded', task
    for _ in range(200):
        draft = workflow.suggestions.get(task['result']['suggestion_id'])
        if draft['status'] != 'running': break
        time.sleep(.01)
    assert draft['status'] == 'completed'
    assert draft['base_body_md'] == long_body
    assert prompts[0]['background_is_excerpt'] is True
    assert len(prompts[0]['saved_body_for_context_only']) <= 20000
    assert 'Important lung evidence' in prompts[0]['saved_body_for_context_only']
    assert workflow.suggestions.garden.get(topic)['revision']['id'] == saved['revision']['id']


@pytest.mark.parametrize('kind', ['chat', 'draft'])
def test_failed_stream_handoff_never_starts_a_model_request(workflow, monkeypatch, kind):
    doc, topic, _ = setup(workflow.suggestions)
    local(workflow)
    def forbidden(*args, **kwargs):
        pytest.fail('a failed handoff must not create a paid stream')
    monkeypatch.setattr('yorw_api.chat.stream', forbidden)
    monkeypatch.setattr('yorw_api.suggestions.stream', forbidden)
    with workflow.db.write() as conn:
        conn.execute("CREATE TRIGGER fail_handoff BEFORE UPDATE OF status ON tasks WHEN new.kind IN ('ai_chat','ai_draft') AND new.status='succeeded' BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
    base = workflow.suggestions.garden.get(topic)['revision']['id']
    _, task = run(workflow, kind, topic if kind == 'draft' else doc, 'lung evidence', base if kind == 'draft' else None, chat_key='secret', chat_version=1)
    assert task['status'] == 'failed'
    children = workflow.suggestions.list(topic)['items'] if kind == 'draft' else workflow.chat.list(doc)['items']
    assert children and children[0]['status'] == 'cancelled'


def test_removed_source_is_not_uploaded_from_a_note_or_wiki_cache(workflow, monkeypatch):
    doc, topic, _ = setup(workflow.suggestions)
    rows = workflow.retriever.prepare(None, None, lambda phase: None)
    original = next(row for row in rows if row['kind'] == 'document')['source']
    note = workflow.suggestions.notes.create(NewNote(id=uuid4(), document_id=doc, body_md='Saved lung opinion.'))
    with workflow.db.write() as conn:
        conn.execute('UPDATE notes SET sources_json=? WHERE id=?', (json.dumps(original['evidence']), note['id']))
    base = workflow.suggestions.garden.get(topic)['revision']
    with workflow.db.write() as conn:
        rid = str(uuid4())
        conn.execute("INSERT INTO revisions(id,topic_id,ordinal,body_md,sources_json,origin,base_revision_id,created_at) VALUES(?,?,2,'Saved lung Wiki.',?,'ai_accepted',?,'time')", (rid, topic, json.dumps([original]), base['id']))
        conn.execute('UPDATE topics SET current_revision_id=? WHERE id=?', (rid, topic))
    workflow.retriever.prepare(None, None, lambda phase: None)
    assert workflow.library.rows('SELECT * FROM knowledge_segments')
    with workflow.db.write() as conn:
        conn.execute("UPDATE documents SET deleted_at='now' WHERE id=?", (doc,))
    assert not workflow.library.rows('SELECT * FROM knowledge_segments')
    assert not workflow.retriever.prepare(None, None, lambda phase: None)
    assert not workflow.library.rows('SELECT * FROM knowledge_segments')
