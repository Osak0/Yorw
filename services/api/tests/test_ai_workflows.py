"""Workflow control and provenance tests, not model-quality benchmarks."""
from io import BytesIO
import json
import time
from threading import Event
from uuid import uuid4

import pytest
from fastapi import HTTPException

from yorw_api.ai_workflows import Workflows, WorkflowInput, Preferences
from yorw_api.garden import CreateTopic, SaveBody, UpdateTopic
from yorw_api.notes import NewNote, NoteBody
from yorw_api.providers import ProbeError
from yorw_api.resources import DocumentResources
from yorw_api.retrieval import spans, excerpt, query_terms
from yorw_api.search_history import SearchHistory
from yorw_api.wiki_review import WikiReview, Accept, Decision
from test_library import library, pdf_bytes
from test_suggestions import service, setup
from test_search import document, config, toy_embed
from test_builtin_parsers import fixtures


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


def run(workflow, kind, target, text, base=None, scope=None, **keys):
    value = WorkflowInput(kind=kind, target_id=target, text=text, base_revision_id=base, request_id=uuid4(), scope=scope)
    return value, settle(workflow, workflow.start(value, **keys))


def wait_draft(workflow, task):
    identity = task['result']['suggestion_id']
    for _ in range(400):
        item = workflow.suggestions.get(identity)
        if item['status'] != 'running':
            return item
        time.sleep(.01)
    pytest.fail('draft did not settle')


def wait_import(library, result):
    for _ in range(400):
        task = library.task(result['task']['id'])
        if task['status'] not in ('queued', 'running'):
            return library.document(result['document']['id'])
        time.sleep(.01)
    pytest.fail('import did not settle')


def scope_fixture(workflow):
    _, target, _ = setup(workflow.suggestions)
    child = workflow.suggestions.garden.create(CreateTopic(id=uuid4(), title='Child scope', parent_id=target))['topic']
    unrelated = workflow.suggestions.garden.create(CreateTopic(id=uuid4(), title='Unrelated scope'))['topic']
    linked_doc = document(workflow.suggestions.search, ['Linked lung evidence for the topic scope.'])
    unrelated_doc = document(workflow.suggestions.search, ['Unrelated lung distractor outside the topic scope.'])
    resources = DocumentResources(workflow.library)
    resources.add_document_topic(linked_doc, target)
    resources.add_document_topic(unrelated_doc, unrelated['id'])
    workflow.suggestions.notes.create(NewNote(id=uuid4(), document_id=linked_doc, body_md='Linked lung note.'))
    workflow.suggestions.notes.create(NewNote(id=uuid4(), document_id=unrelated_doc, body_md='Unrelated lung note.'))
    child_view = workflow.suggestions.garden.get(child['id'])
    workflow.suggestions.garden.save(child['id'], SaveBody(
        base_revision_id=child_view['revision']['id'], body_md='Child lung wiki.'))
    current = workflow.suggestions.garden.get(target)
    saved = workflow.suggestions.garden.save(target, SaveBody(
        base_revision_id=current['revision']['id'], body_md='Current lung background.'))
    return target, child['id'], unrelated['id'], linked_doc, unrelated_doc, saved


def test_topic_scope_defaults_and_workspace_is_explicit(workflow, monkeypatch):
    target, _, _, linked_doc, unrelated_doc, saved = scope_fixture(workflow)
    local(workflow)
    captured = []
    def response(config, key, question, sources, **options):
        captured.append(sources)
        yield 'Scoped draft [S1].'
    monkeypatch.setattr('yorw_api.suggestions.stream', response)

    _, default_task = run(workflow, 'draft', target, 'lung', saved['revision']['id'], chat_key='secret', chat_version=1)
    assert default_task['status'] == 'succeeded', default_task
    default_draft = wait_draft(workflow, default_task)
    default_text = '\n'.join(source['text'] for source in captured[0])
    assert 'Linked lung evidence' in default_text
    assert 'Linked lung note' in default_text
    assert 'Child lung wiki' in default_text
    assert 'Unrelated lung distractor' not in default_text
    assert 'Unrelated lung note' not in default_text
    assert 'Current lung background' not in default_text
    assert default_draft['scope']['mode'] == 'topic' and default_draft['scope_changed'] is False

    _, workspace_task = run(workflow, 'draft', target, 'lung', saved['revision']['id'], scope='workspace', chat_key='secret', chat_version=1)
    assert workspace_task['status'] == 'succeeded', workspace_task
    workspace_draft = wait_draft(workflow, workspace_task)
    workspace_text = '\n'.join(source['text'] for source in captured[-1])
    assert 'Unrelated lung distractor' in workspace_text
    assert 'Unrelated lung note' in workspace_text
    assert 'Current lung background' not in workspace_text
    assert workspace_draft['scope']['mode'] == 'workspace' and workspace_draft['scope_changed'] is False


def test_empty_topic_scope_fails_without_falling_back_or_calling_the_model(workflow, monkeypatch):
    _, target, _ = setup(workflow.suggestions)
    local(workflow)
    def forbidden(*args, **kwargs):
        pytest.fail('empty topic scope must not call the model')
    monkeypatch.setattr('yorw_api.suggestions.stream', forbidden)
    base = workflow.suggestions.garden.get(target)['revision']['id']
    with pytest.raises(HTTPException) as error:
        workflow.start(WorkflowInput(kind='draft', target_id=target, text='lung', base_revision_id=base,
                                     request_id=uuid4(), scope='topic'), chat_key='secret', chat_version=1)
    assert error.value.detail == 'NO_SCOPED_MATERIALS'
    assert workflow.suggestions.list(target)['items'] == []


def test_empty_child_wiki_does_not_count_as_usable_material(workflow, monkeypatch):
    _, target, _ = setup(workflow.suggestions)
    workflow.suggestions.garden.create(CreateTopic(id=uuid4(), title='Empty child', parent_id=target))
    local(workflow)
    def forbidden(*args, **kwargs):
        pytest.fail('empty descendant wiki must not count as usable material')
    monkeypatch.setattr('yorw_api.suggestions.stream', forbidden)
    base = workflow.suggestions.garden.get(target)['revision']['id']
    with pytest.raises(HTTPException) as error:
        workflow.start(WorkflowInput(kind='draft', target_id=target, text='lung', base_revision_id=base,
                                     request_id=uuid4(), scope='topic'), chat_key='secret', chat_version=1)
    assert error.value.detail == 'NO_SCOPED_MATERIALS'
    assert workflow.suggestions.list(target)['items'] == []


def test_scope_tracks_descendant_documents_notes_unlink_and_topic_move(workflow):
    target, child_id, _, _, _, _ = scope_fixture(workflow)
    resources = DocumentResources(workflow.library)
    child_doc = document(workflow.suggestions.search, ['Child descendant lung evidence.'])
    child_note = workflow.suggestions.notes.create(NewNote(
        id=uuid4(), document_id=child_doc, body_md='Child descendant lung note.'))
    resources.add_document_topic(child_doc, child_id)

    scope = workflow.suggestions.scope(target, 'topic')
    assert child_id in scope['wiki_topic_ids']
    assert child_doc in scope['document_ids'] and child_note['id'] in scope['note_ids']

    resources.remove_document_topic(child_doc, child_id)
    unlinked = workflow.suggestions.scope(target, 'topic')
    assert child_doc not in unlinked['document_ids'] and child_note['id'] not in unlinked['note_ids']
    assert unlinked['fingerprint'] != scope['fingerprint']

    resources.add_document_topic(child_doc, child_id)
    child = workflow.suggestions.garden.get(child_id)['topic']
    workflow.suggestions.garden.update(child_id, UpdateTopic(
        title=child['title'], parent_id=None, version=child['version']))
    moved = workflow.suggestions.scope(target, 'topic')
    assert child_id not in moved['wiki_topic_ids']
    assert child_doc not in moved['document_ids'] and child_note['id'] not in moved['note_ids']
    assert moved['fingerprint'] != scope['fingerprint']

    child_now = workflow.suggestions.garden.get(child_id)['topic']
    workflow.suggestions.garden.update(child_id, UpdateTopic(
        title=child['title'], parent_id=target, version=child_now['version']))
    restored = workflow.suggestions.scope(target, 'topic')
    assert restored['fingerprint'] == scope['fingerprint']


def test_scope_change_after_generation_keeps_draft_but_blocks_accept(workflow, monkeypatch):
    target, _, _, linked_doc, _, saved = scope_fixture(workflow)
    local(workflow)
    monkeypatch.setattr('yorw_api.suggestions.stream', lambda *a, **k: iter(['Scoped result [S1].']))
    _, task = run(workflow, 'draft', target, 'lung', saved['revision']['id'], chat_key='secret', chat_version=1)
    draft = wait_draft(workflow, task)
    assert draft['status'] == 'completed' and not draft['scope_changed']
    workflow.suggestions.notes.create(NewNote(id=uuid4(), document_id=linked_doc, body_md='A new note changes the scope.'))
    listed = workflow.suggestions.list(target)['items'][0]
    assert listed['scope_changed'] is True
    assert 'document_ids' not in listed['scope'] and 'note_ids' not in listed['scope']
    review = WikiReview(workflow.suggestions)
    with pytest.raises(HTTPException) as error:
        review.decide(draft['id'], Accept(request_id=uuid4(), base_revision_id=saved['revision']['id'],
                                          body_md='Scoped result [S1].'), True)
    assert error.value.detail == 'SCOPE_CHANGED'
    assert workflow.suggestions.get(draft['id'])['status'] == 'completed'


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


def test_search_history_is_a_deletable_snapshot_and_tasks_remain(workflow):
    local(workflow)
    current = document(workflow.suggestions.search, ['Registration allows individual applicants and teams of three.'])
    value, result = run(workflow, 'search', current, 'registration teams')
    assert result['status'] == 'succeeded', result
    history = SearchHistory(workflow.db)
    entries = history.list(current)['items']
    assert len(entries) == 1
    entry = entries[0]
    assert entry['query'] == 'registration teams'
    assert entry['status'] == 'succeeded'
    assert entry['task_id'] == result['id']
    assert entry['items'] and entry['items'][0]['available'] is True
    assert entry['items'][0]['evidence'][0]['chunk_id']
    assert 'text' not in entry['items'][0]

    history.delete(current, entry['id'])
    assert history.list(current)['items'] == []
    assert workflow.get(result['id'])['status'] == 'succeeded'
    _, second = run(workflow, 'search', current, 'registration teams')
    assert second['status'] == 'succeeded'
    assert len(history.list(current)['items']) == 1
    assert history.clear(current) == {'deleted': 1}
    assert history.list(current)['items'] == []
    assert workflow.get(second['id'])['status'] == 'succeeded'


def test_search_history_records_failure_and_interrupted_restart(workflow, monkeypatch):
    local(workflow)
    current = document(workflow.suggestions.search, ['Registration allows individual applicants.'])
    def fail(*args, **kwargs):
        raise ProbeError('EMBEDDING_FAILED')
    monkeypatch.setattr(workflow.retriever, 'retrieve', fail)
    _, failed = run(workflow, 'search', current, 'registration')
    assert failed['status'] == 'failed'
    entry = SearchHistory(workflow.db).list(current)['items'][0]
    assert entry['status'] == 'failed' and entry['error_code'] == 'EMBEDDING_FAILED'
    monkeypatch.undo()

    history = SearchHistory(workflow.db)
    task_id = str(uuid4())
    with workflow.db.write() as conn:
        conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,created_at,updated_at) VALUES(?,'ai_search',?,'queued','PREPARING','time','time')", (task_id, current))
        history.create(conn, current, str(uuid4()), task_id, 'unfinished')
    restarted = Workflows(workflow.suggestions)
    try:
        assert restarted.get(task_id)['status'] == 'interrupted'
        restored = [item for item in SearchHistory(workflow.db).list(current)['items'] if item['task_id'] == task_id]
        assert restored and restored[0]['status'] == 'interrupted'
    finally:
        restarted.close()


def test_cancelled_search_history_is_not_overwritten_by_a_late_worker(workflow, monkeypatch):
    local(workflow)
    current = document(workflow.suggestions.search, ['Registration allows individual applicants.'])
    started, release = Event(), Event()
    def wait_retrieve(*args, **kwargs):
        started.set()
        release.wait(2)
        raise ProbeError('CANCELLED')
    monkeypatch.setattr(workflow.retriever, 'retrieve', wait_retrieve)
    value = WorkflowInput(kind='search', target_id=current, text='registration', request_id=uuid4())
    task = workflow.start(value)
    workflow.cancel(task['id'])
    release.set()
    started.wait(2)
    time.sleep(.3)
    entries = [item for item in SearchHistory(workflow.db).list(current)['items'] if item['task_id'] == task['id']]
    assert entries and entries[0]['status'] == 'cancelled'


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
    _, task = run(workflow, 'draft', target, 'lung evidence', base, scope='workspace', chat_key='secret', chat_version=1)
    assert task['status'] == 'succeeded', task
    sid = task['result']['suggestion_id']
    for _ in range(200):
        draft = workflow.suggestions.get(sid)
        if draft['status'] != 'running': break
        time.sleep(.01)
    assert draft['status'] == 'completed'
    review = WikiReview(workflow.suggestions)
    accepted = review.decide(sid, Accept(request_id=uuid4(), base_revision_id=base, body_md='First [S1].'), True)['view']
    _, task2 = run(workflow, 'draft', target, 'lung evidence', accepted['revision']['id'], scope='workspace', chat_key='secret', chat_version=1)
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
    _, result = run(workflow, 'draft', topic, 'orbital astrophysics', base, scope='workspace', chat_key='secret', chat_version=1)
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
        assert upgraded.version == 18
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
    _, task = run(workflow, 'draft', topic, 'lung evidence', saved['revision']['id'], scope='workspace', chat_key='secret', chat_version=1)
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
    _, task = run(workflow, kind, topic if kind == 'draft' else doc, 'lung evidence', base if kind == 'draft' else None, scope='workspace' if kind == 'draft' else None, chat_key='secret', chat_version=1)
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


def test_multiformat_blocks_support_search_chat_and_mixed_draft(workflow, monkeypatch):
    setup(workflow.suggestions)
    local(workflow)
    pdf = wait_import(workflow.library, workflow.library.import_pdf(BytesIO(pdf_bytes('Yorw fixture PDF evidence.')), 'fixture.pdf'))
    docx = wait_import(workflow.library, workflow.library.import_document(BytesIO(fixtures.docx_bytes()), 'fixture.docx'))
    md = wait_import(workflow.library, workflow.library.import_document(BytesIO(b'# Methods\n\nMarkdown fixture evidence.\n'), 'fixture.md'))
    assert pdf['format'] == 'pdf' and docx['format'] == 'docx' and md['format'] == 'md'

    _, search_task = run(workflow, 'search', md['id'], 'fixture evidence', chat_key='secret', chat_version=1)
    assert search_task['status'] == 'succeeded', search_task
    hit = search_task['result']['items'][0]
    assert hit['block_id'] and hit['physical_page'] is None and hit['section_path'] == ['Methods']

    asked = []
    def chat_response(cfg, key, question, sources):
        asked.append(sources)
        yield 'Markdown answer [S1].'
    monkeypatch.setattr('yorw_api.chat.stream', chat_response)
    _, chat_task = run(workflow, 'chat', md['id'], 'fixture evidence', chat_key='secret', chat_version=1)
    assert chat_task['status'] == 'succeeded', chat_task
    for _ in range(300):
        message = workflow.chat.message(chat_task['result']['message_id'])
        if message['status'] != 'running':
            break
        time.sleep(.01)
    assert message['status'] == 'completed'
    source = message['sources'][0]
    assert source['block_id'] and source['physical_page'] is None and source['section_path'] == ['Methods']
    assert source['available'] is True
    saved_note = workflow.chat.note(chat_task['result']['message_id'])
    note_source = workflow.suggestions.notes._get(saved_note['id'])['sources'][0]
    assert note_source['block_id'] == source['block_id'] and note_source['available'] is True

    topic = workflow.suggestions.garden.create(CreateTopic(id=uuid4(), title='Mixed fixture scope'))['topic']
    resources = DocumentResources(workflow.library)
    for document in (pdf, docx, md):
        resources.add_document_topic(document['id'], topic['id'])
    base = workflow.suggestions.garden.get(topic['id'])['revision']['id']
    captured = []
    def draft_response(cfg, key, question, sources, **options):
        captured.append(sources)
        yield 'Mixed draft [S1].'
    monkeypatch.setattr('yorw_api.suggestions.stream', draft_response)
    _, draft_task = run(workflow, 'draft', topic['id'], 'fixture evidence', base, scope='topic', chat_key='secret', chat_version=1)
    assert draft_task['status'] == 'succeeded', draft_task
    draft = wait_draft(workflow, draft_task)
    assert draft['status'] == 'completed' and draft['citations'] == [1]
    text = '\n'.join(source['text'] for source in captured[0])
    assert 'Yorw fixed English fixture evidence' in text and 'DOCX fixture' in text and 'Markdown fixture evidence' in text
    evidence = [ref for source in draft['sources'] for ref in source['evidence']]
    assert any(ref.get('physical_page') == 1 for ref in evidence)
    assert any(ref.get('physical_page') is None and ref.get('block_id') for ref in evidence)
