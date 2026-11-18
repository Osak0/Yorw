"""Stage-four migration, original-owner scope and revision compatibility contracts."""
import json
import sqlite3
import shutil
from pathlib import Path
from uuid import uuid4
import pytest
from fastapi import HTTPException
from test_library import library
from test_research import doc
from yorw_api.garden import Garden,CreateTopic,SaveBody,RemoveTopic,UpdateTopic
from yorw_api.notebooks import Notebooks,Create,Scope,Remove,Rename,selected_topics
from yorw_api.research_tools import ResearchTools
from yorw_api.source_status import source_status


def topic(library,title='Owned',parent=None):
    return Garden(library.db).create(CreateTopic(id=uuid4(),title=title,parent_id=parent))['topic']['id']

def create(service,owner,title='Owned note'):
    return service.create(owner,Create(id=uuid4(),title=title))

def write(library,note,text):
    service=Garden(library.db);view=service.get(note['id'])
    return service.save(note['id'],SaveBody(base_revision_id=view['revision']['id'],body_md=text))

def scope(service,owner,rules):
    return service.save_scope(owner,Scope(version=service.topic(owner)['version'],rules=rules))


def test_new_notes_have_separate_heads_and_shared_revision_engine(library):
    owner=topic(library);service=Notebooks(library)
    first=create(service,owner);second=create(service,owner,'Second')
    assert {t['id'] for t in Garden(library.db).list()['items']}=={owner}
    one=write(library,first,'User hypothesis, not a result')
    assert service.get(first['id'])['body_md']=='User hypothesis, not a result'
    assert service.get(second['id'])['body_md']==''
    assert len(Garden(library.db).history(first['id'])['items'])==2
    with pytest.raises(HTTPException) as error:Garden(library.db).save(first['id'],SaveBody(base_revision_id=first['base_revision_id'],body_md='Stale edit'))
    assert error.value.detail=='REVISION_CONFLICT'
    with pytest.raises(sqlite3.IntegrityError):
        with library.db.write() as conn:conn.execute('UPDATE revisions SET body_md=? WHERE id=?',('rewrite history',one['revision']['id']))
    assert service.get(first['id'])['body_md']=='User hypothesis, not a result'
    assert len(service.overview(owner)['owned_notes'])==2


def test_origin_scope_does_not_rebroadcast_another_topics_gathered_notes(library):
    service=Notebooks(library);a=topic(library,'A');b=topic(library,'B',a);c=topic(library,'C')
    nb=create(service,b,'B original');nc=create(service,c,'C original')
    scope(service,b,{b:True,c:True})
    assert {n['id'] for n in service.overview(b)['notes']}=={nb['id'],nc['id']}
    # A sees B's original note, never C merely because B gathered C.
    assert {n['id'] for n in service.overview(a)['notes']}=={nb['id']}
    scope(service,a,{a:True,b:False})
    assert not service.overview(a)['notes']
    child=topic(library,'B new child',b);create(service,child)
    assert child not in selected_topics(library.db,a)
    scope(service,a,{a:True,b:True,c:True})
    assert child in selected_topics(library.db,a)
    scope(service,a,{})
    assert service.overview(a)['scope']['selected']==[]
    assert service.overview(a)['notes']==[]


def test_move_preview_and_inheritance_preserve_explicit_node_exclusions(library):
    service=Notebooks(library);a=topic(library,'A');b=topic(library,'B',a);c=topic(library,'C');d=topic(library,'D',b)
    scope(service,a,{a:True,d:False});scope(service,c,{c:True})
    preview=service.move_preview(b,c)
    assert {t['id'] for t in preview['affected']}=={a,c}
    current=Garden(library.db).get(b)['topic']
    Garden(library.db).update(b,UpdateTopic(title='B',parent_id=c,version=current['version']))
    assert b not in selected_topics(library.db,a) and b in selected_topics(library.db,c)
    assert d not in selected_topics(library.db,a)
    with pytest.raises(HTTPException):service.move_preview(c,d)


def test_document_note_is_deduplicated_and_edits_are_shared(library):
    from yorw_api.notes import Notes,NewNote,NoteBody
    service=Notebooks(library);a=topic(library,'A');b=topic(library,'B',a);did=doc(library)
    with library.db.write() as conn:
        for tid in (a,b):conn.execute('INSERT INTO document_topics VALUES(?,?,?)',(did,tid,'time'))
    note=Notes(library.db).create(NewNote(id=uuid4(),document_id=did,body_md='Owned reading note'))
    assert len([n for n in service.overview(a)['notes'] if n['id']==note['id']])==1
    Notes(library.db).update(note['id'],NoteBody(version=1,body_md='Changed in reading sidebar'))
    assert next(n for n in service.overview(b)['notes'] if n['id']==note['id'])['excerpt']=='Changed in reading sidebar'
    with library.db.write() as conn:conn.execute('DELETE FROM document_topics WHERE topic_id=?',(b,))
    assert Notes(library.db)._get(note['id'])['body_md']=='Changed in reading sidebar'


def test_delete_requires_disposition_even_when_own_notes_are_outside_display_scope(library):
    service=Notebooks(library);a=topic(library,'A');b=topic(library,'B');note=create(service,a)
    scope(service,a,{a:False})
    view=service.overview(a);assert view['notes']==[] and len(view['owned_notes'])==1
    current=Garden(library.db).get(a)['topic']
    with pytest.raises(HTTPException) as error:Garden(library.db).remove(a,RemoveTopic(version=current['version']))
    assert error.value.detail=='NOTE_DISPOSITION_REQUIRED'
    # A later note edit also invalidates a previously inspected owner deletion.
    write(library,note,'Newer content')
    with pytest.raises(HTTPException) as error:Garden(library.db).remove(a,RemoveTopic(version=current['version'],notebook_action='delete'))
    assert error.value.detail=='TOPIC_CONFLICT'
    current=Garden(library.db).get(a)['topic']
    Garden(library.db).remove(a,RemoveTopic(version=current['version'],notebook_action='move',destination_topic_id=b))
    assert service.get(note['id'])['topic_id']==b
    assert service.get(note['id'])['body_md']=='Newer content'


def test_legacy_transfer_preserves_revision_ids_and_accepted_source_snapshots(library):
    service=Notebooks(library);a=topic(library,'Legacy');b=topic(library,'Destination');garden=Garden(library.db)
    before=garden.get(a);saved=garden.save(a,SaveBody(base_revision_id=before['revision']['id'],body_md='Legacy conclusion'))
    history=garden.history(a);assert service.get(a)['id']==a
    garden.remove(a,RemoveTopic(version=saved['topic']['version'],notebook_action='move',destination_topic_id=b))
    assert a not in {t['id'] for t in garden.list()['items']}
    assert service.get(a)['topic_id']==b
    assert garden.history(a)==history
    assert service.overview(b)['notes'][0]['id']==a
    source={'kind':'wiki','source_object_id':a,'source_version':saved['revision']['id'],'evidence':[]}
    assert source_status(library.db,[source])[0]['available']


def test_note_delete_excludes_future_retrieval_but_keeps_immutable_history(library):
    service=Notebooks(library);a=topic(library);note=create(service,a);view=write(library,note,'Unique notebook evidence')
    tools=ResearchTools(library,{'mode':'topic','topic_id':a});assert tools.execute('search_local',{'query':'Unique'})['items']
    source={'kind':'wiki','source_object_id':note['id'],'source_version':view['revision']['id'],'evidence':[]}
    service.remove(note['id'],Remove(version=service.get(note['id'])['version']))
    assert not source_status(library.db,[source])[0]['available']
    assert library.rows('SELECT body_md FROM revisions WHERE id=?',(view['revision']['id'],))[0]['body_md']=='Unique notebook evidence'
    assert not ResearchTools(library,{'mode':'topic','topic_id':a}).execute('search_local',{'query':'Unique'})['items']


def test_research_scope_and_note_visibility_share_one_origin_contract(library):
    service=Notebooks(library);a=topic(library,'A');b=topic(library,'B');nb=create(service,b)
    write(library,nb,'Special cross branch hypothesis')
    assert not ResearchTools(library,{'mode':'topic','topic_id':a}).execute('search_local',{'query':'Special'})['items']
    scope(service,a,{a:True,b:True})
    tools=ResearchTools(library,{'mode':'topic','topic_id':a})
    hit=tools.execute('search_local',{'query':'Special'})['items'][0]
    source=tools.execute('read_local',{'handle':hit['handle']});assert source['object_id']==nb['id']
    scope(service,a,{a:True,b:False})
    assert not ResearchTools(library,{'mode':'topic','topic_id':a}).available(source)


def test_legacy_note_title_can_change_without_renaming_its_owner(library):
    service=Notebooks(library);a=topic(library,'Owner')
    view=Garden(library.db).get(a);Garden(library.db).save(a,SaveBody(base_revision_id=view['revision']['id'],body_md='Legacy note'))
    note=service.get(a);changed=service.rename(a,Rename(title='Note title',version=note['version']))
    assert changed['title']=='Note title' and Garden(library.db).get(a)['topic']['title']=='Owner'


def test_schema27_upgrade_preserves_ids_drafts_and_empty_topic_distinction(tmp_path):
    from yorw_api.storage.database import Database
    from yorw_api.storage.workspace import Workspace
    from yorw_api.library import Library
    scripts=tmp_path/'schema27';scripts.mkdir()
    root=Path(__file__).resolve().parents[1]/'src/yorw_api/migrations'
    for p in root.glob('*.sql'):
        if int(p.name.split('_')[0])<=27:shutil.copyfile(p,scripts/p.name)
    workspace=Workspace(tmp_path/'workspace');db=Database(workspace,scripts)
    empty,body,draft=[str(uuid4()) for _ in range(3)]
    with db.write() as conn:
        for tid,text in ((empty,''),(body,'Retained Wiki'),(draft,'')):
            rid=str(uuid4());conn.execute("INSERT INTO topics(id,title,created_at,updated_at) VALUES(?,?,?,?)",(tid,tid,'time','time'))
            conn.execute("INSERT INTO revisions(id,topic_id,ordinal,body_md,origin,created_at) VALUES(?,?,1,?,'manual','time')",(rid,tid,text))
            conn.execute('UPDATE topics SET current_revision_id=? WHERE id=?',(rid,tid))
        task,suggestion=[str(uuid4()) for _ in range(2)]
        base=conn.execute('SELECT current_revision_id FROM topics WHERE id=?',(draft,)).fetchone()[0]
        conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,created_at,updated_at) VALUES(?,'suggestion',?,'succeeded','DONE','time','time')",(task,draft))
        conn.execute("INSERT INTO suggestions(id,topic_id,base_revision_id,base_body_md,instruction,body_md,sources_json,materials_json,request_json,provider_snapshot_json,prompt_version,status,request_id,task_id,created_at) VALUES(?,?,?,'','owned request','Retained unaccepted draft','[]','[]','{}','{}','fixture','completed',?,?,'time')",(suggestion,draft,base,str(uuid4()),task))
    before=db.connection.execute('SELECT * FROM revisions ORDER BY id').fetchall();db.close()
    for _ in range(2):
        db=Database(workspace);lib=Library(db);service=Notebooks(lib)
        assert db.version==31 and list((workspace.root/'backups').glob('*.sqlite3'))
        assert {n['id'] for n in service.catalog()['items']}=={body,draft}
        assert service.get(draft)['body_md']==''
        assert db.connection.execute('SELECT * FROM revisions ORDER BY id').fetchall()==before
        assert lib.rows('SELECT body_md FROM suggestions WHERE id=?',(suggestion,))[0]['body_md']=='Retained unaccepted draft'
        lib.close();db.close()


def test_failed_migration_rolls_back_and_preserves_backup(tmp_path):
    from yorw_api.storage.database import Database
    from yorw_api.storage.workspace import Workspace
    root=Path(__file__).resolve().parents[1]/'src/yorw_api/migrations';scripts=tmp_path/'sql';scripts.mkdir()
    for p in root.glob('*.sql'):
        if int(p.name.split('_')[0])<=27:shutil.copyfile(p,scripts/p.name)
    workspace=Workspace(tmp_path/'workspace');db=Database(workspace,scripts);db.close()
    (scripts/'028_fixture.sql').write_text('CREATE TABLE rollback_probe(id INTEGER);\nSELECT * FROM deliberately_missing_table;\n',encoding='utf-8')
    with pytest.raises(sqlite3.OperationalError):Database(workspace,scripts)
    with sqlite3.connect(workspace.root/'yorw.sqlite3') as conn:
        assert conn.execute('PRAGMA user_version').fetchone()[0]==27
        assert not conn.execute("SELECT name FROM sqlite_master WHERE name='rollback_probe'").fetchone()
    assert list((workspace.root/'backups').glob('*.sqlite3'))


def test_deleted_legacy_note_does_not_leak_through_owner_export(library):
    service=Notebooks(library);owner=topic(library)
    initial=Garden(library.db).get(owner)
    saved=Garden(library.db).save(owner,SaveBody(base_revision_id=initial['revision']['id'],body_md='Legacy text explicitly deleted'))
    service.remove(owner,Remove(version=service.get(owner)['version']))
    assert service.overview(owner)['owned_notes']==[]
    assert Garden(library.db).get(owner)['revision']['body_md']==''
    assert library.rows('SELECT body_md FROM revisions WHERE id=?',(saved['revision']['id'],))[0]['body_md']=='Legacy text explicitly deleted'
