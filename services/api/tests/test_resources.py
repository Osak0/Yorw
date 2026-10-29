from io import BytesIO
import json
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from yorw_api.garden import CreateTopic, Garden, UpdateTopic
from yorw_api.library import Metadata
from yorw_api.notes import NewNote, NoteBody, Notes
from yorw_api.resources import DocumentResources
from yorw_api.search_history import SearchHistory
from yorw_api.storage.database import Database
from yorw_api.storage.workspace import Workspace
from test_library import library, pdf_bytes, wait


def imported(library, name='fixture.pdf', text=True):
    # Distinct trailing comment keeps fixture digests unique without changing pages.
    content = pdf_bytes(text) + f'\n%{name}\n'.encode()
    return wait(library, library.import_pdf(BytesIO(content), name))


def test_manual_tags_and_summary_are_normalized_persisted_and_clearable(library):
    document = imported(library)
    updated = library.update(document['id'], Metadata(
        version=document['version'], title='Manual title', authors=['Osako'], year=2026,
        tags=[' Machine Learning ', '', 'machine learning', '因果推断', '  '],
        summary_md='  本文研究检索增强生成的方法与边界。  '))
    assert updated['tags'] == ['Machine Learning', '因果推断']
    assert updated['summary_md'] == '本文研究检索增强生成的方法与边界。'
    assert updated['summary_source'] == 'manual'
    assert updated['summary_updated_at']
    assert updated['metadata_source']['title'] == 'user'

    # Omitted fields preserve existing values for older clients.
    preserved = library.update(document['id'], Metadata(
        version=updated['version'], title='Renamed', authors=['Osako'], year=2026))
    assert preserved['tags'] == ['Machine Learning', '因果推断']
    assert preserved['summary_md'] == updated['summary_md']
    assert preserved['summary_updated_at'] == updated['summary_updated_at']

    reopened = Database(Workspace(library.workspace.root))
    try:
        row = reopened.connection.execute(
            'SELECT summary_md,summary_source,summary_updated_at FROM documents WHERE id=?',
            (document['id'],)).fetchone()
        assert row == (updated['summary_md'], 'manual', updated['summary_updated_at'])
        assert reopened.connection.execute(
            'SELECT tag FROM document_tags WHERE document_id=? ORDER BY created_at,tag_key',
            (document['id'],)).fetchall() == [('Machine Learning',), ('因果推断',)]
    finally:
        reopened.close()

    cleared = library.update(document['id'], Metadata(
        version=preserved['version'], title='Renamed', authors=['Osako'], year=2026,
        tags=[], summary_md='   '))
    assert cleared['tags'] == []
    assert cleared['summary_md'] is None
    assert cleared['summary_source'] is None
    assert cleared['summary_updated_at'] is None
    with pytest.raises(HTTPException) as conflict:
        library.update(document['id'], Metadata(version=updated['version'], title='stale'))
    assert conflict.value.detail == 'DOCUMENT_CONFLICT'
    assert library.document(document['id'])['tags'] == []


def test_metadata_rejects_oversized_tags_and_summary(library):
    document = imported(library)
    with pytest.raises(HTTPException) as too_many:
        library.update(document['id'], Metadata(
            version=document['version'], tags=[f'tag-{index}' for index in range(51)]))
    assert too_many.value.detail == 'INVALID_METADATA'
    with pytest.raises(HTTPException) as long_tag:
        library.update(document['id'], Metadata(
            version=document['version'], tags=['x' * 41]))
    assert long_tag.value.detail == 'INVALID_METADATA'
    with pytest.raises(ValidationError):
        Metadata(version=document['version'], summary_md='x' * 20_001)
    assert library.document(document['id'])['version'] == document['version']


def test_metadata_update_only_claims_and_writes_supplied_fields(library):
    document = imported(library)
    assert document['title'] == 'Fixture title'
    assert document['authors'] == ['Fixture Author']
    assert document['metadata_source']['title'] == 'pdf'
    assert document['metadata_source']['authors'] == 'pdf'

    # Import organizer saves only tags: extracted PDF metadata must survive and
    # must not be relabelled as user-entered.
    tagged = library.update(document['id'], Metadata(
        version=document['version'], tags=['导入整理']))
    assert tagged['title'] == 'Fixture title'
    assert tagged['authors'] == ['Fixture Author']
    assert tagged['year'] is None
    assert tagged['metadata_source']['title'] == 'pdf'
    assert tagged['metadata_source']['authors'] == 'pdf'
    assert tagged['metadata_source'].get('year') != 'user'
    assert tagged['metadata_source']['tags'] == 'user'

    # Explicit null/[] from a user still clears and claims the field.
    cleared = library.update(tagged['id'], Metadata(
        version=tagged['version'], title=None, authors=[], year=None))
    assert cleared['title'] is None
    assert cleared['authors'] == []
    assert cleared['metadata_source']['title'] == 'user'
    assert cleared['metadata_source']['authors'] == 'user'
    assert cleared['metadata_source']['year'] == 'user'


def test_metadata_saved_before_extraction_does_not_block_pdf_metadata(library):
    content = pdf_bytes() + b'\n%early-metadata\n'
    result = library.import_pdf(BytesIO(content), 'early.pdf')
    pending = result['document']
    assert pending['extraction_status'] in ('pending', 'running', 'ready')

    library.update(pending['id'], Metadata(version=pending['version'], tags=['先整理']))
    extracted = wait(library, result)

    assert extracted['extraction_status'] == 'ready'
    assert extracted['title'] == 'Fixture title'
    assert extracted['authors'] == ['Fixture Author']
    assert extracted['metadata_source']['title'] == 'pdf'
    assert extracted['metadata_source']['authors'] == 'pdf'
    assert extracted['tags'] == ['先整理']


def test_document_resource_aggregates_metadata_notes_chat_and_search_history(library):
    document = imported(library)
    library.update(document['id'], Metadata(
        version=document['version'], title='Resource paper', authors=['Author'], year=2026,
        tags=['检索增强'], summary_md='人工总结。'))
    notes = Notes(library.db)
    note = notes.create(NewNote(id=uuid4(), document_id=document['id'], body_md='# 笔记标题\n\n我的理解。'))
    chunk = library.rows('SELECT * FROM chunks WHERE document_id=?', (document['id'],))[0]
    message_id = str(uuid4())
    with library.db.write() as conn:
        conn.execute("INSERT INTO conversations(id,document_id,created_at) VALUES('conversation',?,'time')", (document['id'],))
        conn.execute("INSERT INTO messages(id,conversation_id,question,body_md,status,sources_json,provider_json,created_at) VALUES(?, 'conversation','问题','回答 [S1]','completed',?,'{}','time')",
                     (message_id, json.dumps([{'chunk_id': chunk['id'], 'document_id': document['id'], 'physical_page': 1,
                                                'text': chunk['text'], 'extraction_version': chunk['extraction_version']}])))
        task_id, history_id = str(uuid4()), str(uuid4())
        conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,created_at,updated_at) VALUES(?,'ai_search',?,'succeeded','READY','time','time')", (task_id, document['id']))
        conn.execute("INSERT INTO search_history(id,document_id,request_id,task_id,query,status,results_json,reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                     (history_id, document['id'], str(uuid4()), task_id, '检索增强', 'succeeded',
                      json.dumps([{'id': 'segment', 'kind': 'document', 'object_id': document['id'], 'title': 'Resource paper',
                                                'snippet': '原文摘录', 'snippet_start': 0, 'snippet_end': 4,
                                                'document_id': document['id'], 'physical_page': 1,
                                                'evidence': [{'document_id': document['id'], 'chunk_id': chunk['id'], 'physical_page': 1,
                                                              'extraction_version': chunk['extraction_version'], 'quote': chunk['text'][:20]}]}]),
                      None, 'time', 'time'))
    view = DocumentResources(library).view(document['id'])
    assert view['document']['title'] == 'Resource paper'
    assert view['document']['tags'] == ['检索增强']
    assert view['document']['summary_md'] == '人工总结。'
    assert [item['id'] for item in view['notes']] == [note['id']]
    assert view['notes'][0]['excerpt'].startswith('# 笔记标题') or '我的理解' in view['notes'][0]['excerpt']
    assert view['chat'][0]['id'] == message_id and view['chat'][0]['citations'] == 1
    assert view['search_history'][0]['id'] == history_id
    assert view['search_history'][0]['items'][0]['available'] is True

    SearchHistory(library.db).delete(document['id'], history_id)
    assert SearchHistory(library.db).list(document['id'])['items'] == []
    assert notes.list(document['id'])[0]['body_md'].startswith('# 笔记标题')
    assert library.rows('SELECT id FROM messages WHERE id=?', (message_id,)) == [{'id': message_id}]


def test_removing_document_cancels_running_search_history(library):
    document = imported(library)
    history = SearchHistory(library.db)
    with library.db.write() as conn:
        task_id = str(uuid4())
        conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,created_at,updated_at) VALUES(?,'ai_search',?,'running','SEARCHING','time','time')", (task_id, document['id']))
        history.create(conn, document['id'], str(uuid4()), task_id, 'running query')
        history.mark_running(conn, task_id)
    library.remove(document['id'], document['version'])
    entry = history.list(document['id'])['items'][0]
    assert entry['status'] == 'cancelled'
    assert entry['error_code'] == 'DOCUMENT_REMOVED'
    assert library.task(task_id)['status'] == 'cancelled'
    assert library.task(task_id)['stage'] == 'DOCUMENT_REMOVED'


def test_search_history_marks_sources_unavailable_after_reextraction(library):
    document = imported(library)
    chunk = library.rows('SELECT * FROM chunks WHERE document_id=?', (document['id'],))[0]
    history = SearchHistory(library.db)
    with library.db.write() as conn:
        task_id = str(uuid4())
        conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,created_at,updated_at) VALUES(?,'ai_search',?,'succeeded','READY','time','time')", (task_id, document['id']))
        history.create(conn, document['id'], str(uuid4()), task_id, '问题')
        history.finish_with(conn, task_id, 'succeeded', {'items': [{
            'id': 'segment', 'kind': 'document', 'object_id': document['id'], 'title': 'Paper',
            'snippet': '摘录', 'snippet_start': 0, 'snippet_end': 2, 'document_id': document['id'], 'physical_page': 1,
            'evidence': [{'document_id': document['id'], 'chunk_id': chunk['id'], 'physical_page': 1,
                          'extraction_version': chunk['extraction_version'], 'quote': chunk['text'][:10]}]}], 'reason': None})
    assert history.list(document['id'])['items'][0]['items'][0]['available'] is True
    with library.db.write() as conn:
        conn.execute('UPDATE documents SET extraction_version=extraction_version+1 WHERE id=?', (document['id'],))
    assert history.list(document['id'])['items'][0]['items'][0]['available'] is False


def test_document_relations_are_bidirectional_idempotent_and_unlink_keeps_documents(library):
    first, second, third = imported(library, 'first.pdf'), imported(library, 'second.pdf'), imported(library, 'third.pdf')
    resources = DocumentResources(library)
    created = resources.add_relation(first['id'], second['id'], '  共同讨论检索增强  ')
    relation = created['relation']
    assert relation['description'] == '共同讨论检索增强'
    assert [item['document']['id'] for item in resources.relations(first['id'])['items']] == [second['id']]
    assert [item['document']['id'] for item in resources.relations(second['id'])['items']] == [first['id']]
    same = resources.add_relation(first['id'], second['id'], '共同讨论检索增强')
    assert same['relation']['updated_at'] == relation['updated_at']
    reverse = resources.add_relation(second['id'], first['id'], '共同讨论检索增强')
    assert reverse['relation']['updated_at'] == relation['updated_at']
    changed = resources.add_relation(second['id'], first['id'], '更新后的说明')
    assert changed['relation']['description'] == '更新后的说明'
    assert len(resources.relations(first['id'])['items']) == 1

    with pytest.raises(HTTPException) as self_link:
        resources.add_relation(first['id'], first['id'], '')
    assert self_link.value.detail == 'RELATION_SELF'
    with pytest.raises(HTTPException) as missing:
        resources.add_relation(first['id'], str(uuid4()), '')
    assert missing.value.status_code == 404
    with pytest.raises(HTTPException) as too_long:
        resources.add_relation(first['id'], third['id'], 'x' * 501)
    assert too_long.value.detail == 'INVALID_INPUT'

    assert resources.remove_relation(second['id'], first['id']) == {'removed': True}
    assert resources.relations(first['id'])['items'] == []
    assert resources.relations(second['id'])['items'] == []
    assert {item['id'] for item in library.list()} >= {first['id'], second['id'], third['id']}
    assert resources.remove_relation(second['id'], first['id']) == {'removed': False}


def test_relation_candidates_and_tag_matches_assist_without_creating_links(library):
    first, second, third = imported(library, 'first.pdf'), imported(library, 'second.pdf'), imported(library, 'third.pdf')
    library.update(first['id'], Metadata(version=first['version'], title='Retrieval paper', authors=[], tags=['RAG', '检索']))
    library.update(second['id'], Metadata(version=second['version'], title='Shared tags', authors=['Second Author'], tags=['rag', '因果推断']))
    library.update(third['id'], Metadata(version=third['version'], title='Unrelated', authors=[], tags=['其他']))
    resources = DocumentResources(library)
    candidates = resources.candidates(first['id'], 'shared')
    assert [item['id'] for item in candidates['items']] == [second['id']]
    assert candidates['items'][0]['shared_tags'] == ['RAG']
    tag_matches = resources.view(first['id'])['tag_matches']
    assert [item['document']['id'] for item in tag_matches] == [second['id']]
    assert tag_matches[0]['shared_tags'] == ['RAG']
    assert resources.view(first['id'])['related'] == []
    resources.add_relation(first['id'], second['id'], '手动关联')
    assert resources.view(first['id'])['tag_matches'] == []


def test_relation_to_removed_document_is_shown_unavailable(library):
    first, second = imported(library, 'first.pdf'), imported(library, 'second.pdf')
    resources = DocumentResources(library)
    resources.add_relation(first['id'], second['id'], '保留关系')
    library.remove(second['id'], second['version'])
    items = resources.relations(first['id'])['items']
    assert len(items) == 1 and items[0]['document']['id'] == second['id']
    assert items[0]['document_available'] is False
    with pytest.raises(HTTPException):
        resources.add_relation(first['id'], second['id'], '')


def test_schema11_upgrade_preserves_research_assets_and_initializes_stage_b_tables(tmp_path):
    import shutil
    from pathlib import Path

    scripts = tmp_path / 'schema11-migrations'
    scripts.mkdir()
    for path in sorted((Path(__file__).parents[1] / 'src/yorw_api/migrations').glob('*.sql'))[:11]:
        shutil.copy2(path, scripts / path.name)
    workspace = Workspace(tmp_path / 'workspace')
    old = Database(workspace, scripts)
    with old.write() as conn:
        conn.execute("INSERT INTO documents(id,sha256,original_name,title,authors_json,extraction_status,created_at,updated_at) VALUES('doc','digest','paper.pdf','Retained paper','[\"Author\"]','ready','time','time')")
        conn.execute("INSERT INTO chunks(id,document_id,extraction_version,ordinal,physical_page,text) VALUES('chunk','doc',1,0,1,'Retained evidence')")
        conn.execute("INSERT INTO notes(id,document_id,body_md,created_at,updated_at) VALUES('note','doc','Retained note 中文','time','time')")
        conn.execute("INSERT INTO conversations VALUES('conversation','doc','time')")
        conn.execute("INSERT INTO messages(id,conversation_id,question,body_md,status,sources_json,provider_json,created_at) VALUES('message','conversation','Question','Retained answer','completed','[]','{}','time')")
        conn.execute("INSERT INTO topics(id,title,created_at,updated_at) VALUES('topic','Retained topic','time','time')")
        conn.execute("INSERT INTO revisions(id,topic_id,ordinal,body_md,origin,created_at) VALUES('revision','topic',1,'Retained Wiki','manual','time')")
        conn.execute("UPDATE topics SET current_revision_id='revision' WHERE id='topic'")
    old.close()
    upgraded = Database(workspace)
    try:
        assert upgraded.version == 19
        assert upgraded.connection.execute('SELECT title,summary_md FROM documents').fetchone() == ('Retained paper', None)
        assert upgraded.connection.execute('SELECT body_md FROM notes').fetchone() == ('Retained note 中文',)
        assert upgraded.connection.execute('SELECT body_md FROM messages').fetchone() == ('Retained answer',)
        assert upgraded.connection.execute('SELECT body_md FROM revisions').fetchone() == ('Retained Wiki',)
        for table in ('document_tags', 'document_relations', 'document_topics', 'search_history'):
            assert upgraded.connection.execute(f'SELECT count(*) FROM {table}').fetchone() == (0,)
        assert upgraded.connection.execute('PRAGMA foreign_key_check').fetchall() == []
        assert len(list((workspace.root / 'backups').glob('*.sqlite3'))) == 1
    finally:
        upgraded.close()


def topic(garden, title, parent=None):
    return garden.create(CreateTopic(id=uuid4(), title=title, parent_id=parent))['topic']


def test_document_topic_links_are_many_to_many_idempotent_and_removable(library):
    document = imported(library)
    garden = Garden(library.db)
    first, second = topic(garden, 'First'), topic(garden, 'Second')
    resources = DocumentResources(library)
    assert resources.add_document_topic(document['id'], first['id']) == {'linked': True}
    assert resources.add_document_topic(document['id'], first['id']) == {'linked': True}
    assert resources.add_document_topic(document['id'], second['id']) == {'linked': True}
    links = resources.document_topics(document['id'])
    assert [item['topic']['id'] for item in links] == [first['id'], second['id']]
    assert links[0]['path'] == ['First']
    assert [item['topic']['id'] for item in resources.view(document['id'])['topics']] == [first['id'], second['id']]
    assert resources.remove_document_topic(document['id'], first['id']) == {'linked': False}
    assert [item['topic']['id'] for item in resources.document_topics(document['id'])] == [second['id']]
    assert resources.remove_document_topic(document['id'], first['id']) == {'linked': False}
    with pytest.raises(HTTPException) as missing:
        resources.add_document_topic(document['id'], str(uuid4()))
    assert missing.value.status_code == 404


def test_topic_materials_separate_direct_descendant_and_dedupe_notes(library):
    first, second, third = imported(library, 'first.pdf'), imported(library, 'second.pdf'), imported(library, 'third.pdf')
    notes = Notes(library.db)
    note_first = notes.create(NewNote(id=uuid4(), document_id=first['id'], body_md='First note'))
    note_second = notes.create(NewNote(id=uuid4(), document_id=second['id'], body_md='Second note'))
    note_third = notes.create(NewNote(id=uuid4(), document_id=third['id'], body_md='Third note'))
    garden = Garden(library.db)
    parent = topic(garden, 'Parent')
    sibling = topic(garden, 'Sibling')
    child = topic(garden, 'Child', parent['id'])
    resources = DocumentResources(library)
    resources.add_document_topic(first['id'], parent['id'])
    resources.add_document_topic(second['id'], child['id'])
    resources.add_document_topic(third['id'], sibling['id'])

    materials = resources.topic_materials(parent['id'])
    assert [item['document']['id'] for item in materials['direct']] == [first['id']]
    assert [item['document']['id'] for item in materials['inherited']] == [second['id']]
    assert materials['inherited'][0]['topics'] == [{'id': child['id'], 'title': 'Child'}]
    assert {item['id'] for item in materials['notes']} == {note_first['id'], note_second['id']}
    assert resources.topic_materials(sibling['id'])['notes'][0]['id'] == note_third['id']
    assert resources.topic_materials(child['id'])['notes'][0]['id'] == note_second['id']

    resources.add_document_topic(second['id'], parent['id'])
    materials = resources.topic_materials(parent['id'])
    assert [item['document']['id'] for item in materials['direct']] == [first['id'], second['id']]
    assert materials['inherited'] == []
    assert {item['id'] for item in materials['notes']} == {note_first['id'], note_second['id']}

    notes.update(note_second['id'], NoteBody(body_md='Edited live note', version=1))
    for topic_id in (parent['id'], child['id']):
        assert any(item['id'] == note_second['id'] and item['excerpt'] == 'Edited live note'
                   for item in resources.topic_materials(topic_id)['notes'])

    resources.remove_document_topic(first['id'], parent['id'])
    assert {item['id'] for item in resources.topic_materials(parent['id'])['notes']} == {note_second['id']}
    assert notes.list(first['id'])[0]['id'] == note_first['id']


def test_topic_move_recalculates_descendant_materials_without_rewriting_wiki_snapshots(library):
    document = imported(library)
    garden = Garden(library.db)
    parent = topic(garden, 'Parent')
    moving = topic(garden, 'Moving', parent['id'])
    destination = topic(garden, 'Destination')
    resources = DocumentResources(library)
    resources.add_document_topic(document['id'], moving['id'])
    assert [item['document']['id'] for item in resources.topic_materials(parent['id'])['inherited']] == [document['id']]
    source_revision = garden.create(CreateTopic(id=uuid4(), title='Sourced'))
    sourced_id = str(uuid4())
    with library.db.write() as conn:
        conn.execute("INSERT INTO revisions(id,topic_id,ordinal,body_md,sources_json,origin,created_at) VALUES(?,?,2,'sourced body',?,'fixture','time')",
                     (sourced_id, source_revision['topic']['id'],
                      json.dumps([{'kind': 'document', 'source_object_id': document['id']}])))
        conn.execute('UPDATE topics SET current_revision_id=? WHERE id=?', (sourced_id, source_revision['topic']['id']))
    before = library.rows('SELECT sources_json FROM revisions WHERE id=?', (sourced_id,))[0]['sources_json']
    garden.update(moving['id'], UpdateTopic(title='Moving', parent_id=destination['id'], version=moving['version']))
    assert resources.topic_materials(parent['id'])['inherited'] == []
    assert [item['document']['id'] for item in resources.topic_materials(destination['id'])['inherited']] == [document['id']]
    assert library.rows('SELECT sources_json FROM revisions WHERE id=?', (sourced_id,))[0]['sources_json'] == before


def test_metadata_tags_are_removed_with_the_document_record_not_the_file(library):
    document = imported(library)
    updated = library.update(document['id'], Metadata(
        version=document['version'], tags=['keep-me'], summary_md='保留总结'))
    library.remove(updated['id'], updated['version'])
    assert library.rows('SELECT tag FROM document_tags WHERE document_id=?', (document['id'],)) == [{'tag': 'keep-me'}]
    assert library.rows('SELECT summary_md FROM documents WHERE id=?', (document['id'],)) == [{'summary_md': '保留总结'}]
    reimported = imported(library, 'fixture.pdf')
    assert reimported['id'] == document['id']
    assert reimported['tags'] == ['keep-me']
    assert reimported['summary_md'] == '保留总结'
