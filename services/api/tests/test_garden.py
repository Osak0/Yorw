import json
import sqlite3
from uuid import uuid4
import pytest
from fastapi import HTTPException
from yorw_api.garden import Garden,CreateTopic,UpdateTopic,SaveBody
from test_library import library

@pytest.fixture
def garden(library):return Garden(library.db)

def create(garden,title='Topic',parent=None):
    return garden.create(CreateTopic(id=uuid4(),title=title,parent_id=parent))

def test_tree_moves_versions_and_cycles_are_atomic(garden):
    a=create(garden,'A');b=create(garden,'B',a['topic']['id']);c=create(garden,'C',b['topic']['id'])
    aid,bid,cid=[t['topic']['id'] for t in (a,b,c)]
    for target in (aid,cid):
        with pytest.raises(HTTPException) as error:
            garden.update(aid,UpdateTopic(title='changed',parent_id=target,version=1))
        assert error.value.detail=='TOPIC_CYCLE'
        assert garden.get(aid)==a
    with pytest.raises(HTTPException):garden.update(aid,UpdateTopic(title='changed',parent_id=uuid4(),version=1))
    moved=garden.update(bid,UpdateTopic(title='Renamed',parent_id=None,version=1))
    assert moved['topic']['version']==2 and moved['topic']['parent_id'] is None
    with pytest.raises(HTTPException) as error:garden.update(bid,UpdateTopic(title='stale',version=1))
    assert error.value.detail=='TOPIC_CONFLICT'
    assert len(garden.history(bid)['items'])==1
    assert garden.get(cid)['topic']['parent_id']==bid


def test_revision_conflicts_retry_and_immutable_history(garden):
    first=create(garden)
    identity=first['topic']['id'];base=first['revision']['id']
    assert first['revision']['ordinal']==1 and first['revision']['body_md']==''
    value=SaveBody(body_md='# Research\n\n中文正文',base_revision_id=base)
    second=garden.save(identity,value)
    assert second['revision']['ordinal']==2 and second['topic']['version']==2
    assert garden.save(identity,value)==second
    assert garden.save(identity,SaveBody(body_md=second['revision']['body_md'],base_revision_id=second['revision']['id']))==second
    with pytest.raises(HTTPException) as error:garden.save(identity,SaveBody(body_md='stale overwrite',base_revision_id=base))
    assert error.value.detail=='REVISION_CONFLICT'
    other=create(garden,'Other')
    with pytest.raises(HTTPException):garden.save(identity,SaveBody(body_md='cross topic',base_revision_id=other['revision']['id']))
    assert [r['ordinal'] for r in garden.history(identity)['items']]==[2,1]
    assert garden.get(identity)==second
    with pytest.raises(sqlite3.IntegrityError):
        with garden.db.write() as conn:conn.execute("UPDATE revisions SET body_md='overwrite' WHERE id=?",(base,))
    with pytest.raises(sqlite3.IntegrityError):
        with garden.db.write() as conn:conn.execute('DELETE FROM revisions WHERE id=?',(base,))
    assert garden.get(identity)==second


def test_save_failure_rolls_back_pointer_and_preserves_sources(garden):
    first=create(garden)
    identity=first['topic']['id']
    # A future accepted-source revision: manual edits must keep its source snapshot.
    source=[{'kind':'document','excerpt':'retained quote'}]
    with garden.db.write() as conn:
        rid=str(uuid4())
        conn.execute("INSERT INTO revisions(id,topic_id,ordinal,body_md,sources_json,origin,created_at) VALUES(?,?,2,'sourced',?,'fixture','time')",(rid,identity,json.dumps(source)))
        conn.execute('UPDATE topics SET current_revision_id=? WHERE id=?',(rid,identity))
    baseline=garden.get(identity)
    with garden.db.write() as conn:conn.execute("CREATE TRIGGER reject_revision BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
    with pytest.raises(sqlite3.IntegrityError):garden.save(identity,SaveBody(body_md='unsaved',base_revision_id=rid))
    assert garden.get(identity)==baseline and len(garden.history(identity)['items'])==2
    with garden.db.write() as conn:conn.execute('DROP TRIGGER reject_revision')
    saved=garden.save(identity,SaveBody(body_md='edited',base_revision_id=rid))
    assert saved['revision']['sources']==[{**source[0],'available':False}]
    assert json.loads(garden.db.connection.execute('SELECT sources_json FROM revisions WHERE id=?',(saved['revision']['id'],)).fetchone()[0])==source


def test_create_is_atomic_idempotent_and_rejects_invalid_fields(garden):
    value=CreateTopic(id=uuid4(),title='  First  ')
    first=garden.create(value)
    assert garden.create(value)==first and first['topic']['title']=='First'
    with pytest.raises(HTTPException):garden.create(value.model_copy(update={'title':'Different'}))
    with garden.db.write() as conn:conn.execute("CREATE TRIGGER reject_creation BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
    with pytest.raises(sqlite3.IntegrityError):create(garden,'cannot persist')
    assert len(garden.list()['items'])==1
    from pydantic import ValidationError
    for title in ['','   ','x'*121]:
        with pytest.raises(ValidationError):CreateTopic(id=uuid4(),title=title)


def test_step9_database_upgrade_preserves_existing_research_assets(tmp_path):
    from pathlib import Path
    import shutil
    from yorw_api.storage.workspace import Workspace
    from yorw_api.storage.database import Database
    old_scripts=tmp_path/'step9-migrations'
    old_scripts.mkdir()
    for file in sorted((Path(__file__).parents[1]/'src/yorw_api/migrations').glob('*.sql'))[:6]:
        shutil.copy2(file,old_scripts/file.name)
    workspace=Workspace(tmp_path/'workspace')
    old=Database(workspace,old_scripts)
    with old.write() as conn:
        conn.execute("INSERT INTO documents(id,sha256,original_name,extraction_status,created_at,updated_at) VALUES('doc','digest','paper.pdf','ready','time','time')")
        conn.execute("INSERT INTO notes(id,document_id,body_md,created_at,updated_at) VALUES('note','doc','Retained note 中文','time','time')")
        conn.execute("INSERT INTO conversations VALUES('conversation','doc','time')")
        conn.execute("INSERT INTO messages(id,conversation_id,question,body_md,status,sources_json,provider_json,created_at) VALUES('message','conversation','Question','Retained answer','completed','[]','{}','time')")
    old.close()
    updated=Database(workspace)
    try:
        assert updated.version==23
        assert updated.connection.execute('SELECT body_md FROM notes').fetchone()[0]=='Retained note 中文'
        assert updated.connection.execute('SELECT body_md FROM messages').fetchone()[0]=='Retained answer'
        assert updated.connection.execute('SELECT count(*) FROM topics').fetchone()[0]==0
        assert updated.connection.execute('PRAGMA foreign_key_check').fetchall()==[]
    finally:updated.close()

def test_remove_promotes_children_preserves_history_and_rejects_stale_version(garden):
    from yorw_api.garden import RemoveTopic
    parent=create(garden,'Parent');removed=create(garden,'Remove',parent['topic']['id'])
    identity=removed['topic']['id'];child=create(garden,'Child',identity)
    leaf=create(garden,'Leaf',child['topic']['id'])
    saved=garden.save(identity,SaveBody(body_md='Saved evidence',base_revision_id=removed['revision']['id']))
    with pytest.raises(HTTPException) as conflict:garden.remove(identity,RemoveTopic(version=1))
    assert conflict.value.detail=='TOPIC_CONFLICT'
    assert garden.get(child['topic']['id'])['topic']['parent_id']==identity
    result=garden.remove(identity,RemoveTopic(version=saved['topic']['version']))
    assert identity not in [t['id'] for t in result['items']]
    promoted=garden.get(child['topic']['id'])['topic']
    assert promoted['parent_id']==parent['topic']['id'] and promoted['version']==2
    assert garden.get(leaf['topic']['id'])['topic']['parent_id']==child['topic']['id']
    for action in (lambda:garden.get(identity),lambda:garden.save(identity,SaveBody(body_md='late',base_revision_id=saved['revision']['id'])),lambda:garden.remove(identity,RemoveTopic(version=2)),lambda:create(garden,'Late child',identity)):
        with pytest.raises(HTTPException) as missing:action()
        assert missing.value.detail=='TOPIC_NOT_FOUND'
    assert garden.db.connection.execute('SELECT body_md FROM revisions WHERE id=?',(saved['revision']['id'],)).fetchone()[0]=='Saved evidence'
    assert garden.db.connection.execute('PRAGMA foreign_key_check').fetchall()==[]
    garden.remove(parent['topic']['id'],RemoveTopic(version=1))
    assert garden.get(child['topic']['id'])['topic']['parent_id'] is None


def test_removed_topic_is_unlinked_not_exported_or_retrieved_and_stays_removed(library):
    from types import SimpleNamespace
    from yorw_api.garden import RemoveTopic
    from yorw_api.resources import DocumentResources
    from yorw_api.retrieval import EvidenceRetriever
    from yorw_api.source_status import source_status
    from yorw_api.storage.database import Database
    garden=Garden(library.db);item=create(garden)
    identity=item['topic']['id']
    saved=garden.save(identity,SaveBody(body_md='Topic removal evidence',base_revision_id=item['revision']['id']))
    doc=str(uuid4())
    with library.db.write() as conn:
        conn.execute("INSERT INTO documents(id,sha256,original_name,extraction_status,created_at,updated_at) VALUES(?,?,'fixture.txt','ready','time','time')",(doc,str(uuid4())))
    resources=DocumentResources(library);resources.add_document_topic(doc,identity)
    retrieval=EvidenceRetriever(SimpleNamespace(library=library,db=library.db))
    records=retrieval._catalog()
    assert any(r[1]==identity for r in records)
    source={'kind':'wiki','source_object_id':identity,'source_version':saved['revision']['id'],'evidence':[]}
    assert source_status(library.db,[source])[0]['available']
    garden.remove(identity,RemoveTopic(version=2))
    assert resources.document_topics(doc)==[]
    assert not any(r[1]==identity for r in retrieval._catalog())
    assert not source_status(library.db,[source])[0]['available']
    with pytest.raises(HTTPException):resources.add_document_topic(doc,identity)
    with pytest.raises(HTTPException):resources.topic_materials(identity)
    # Reopen the same database; the tombstone and immutable revisions survive restart.
    reopened=Database(library.workspace)
    try:
        assert identity not in [t['id'] for t in Garden(reopened).list()['items']]
        assert reopened.connection.execute('SELECT count(*) FROM revisions WHERE topic_id=?',(identity,)).fetchone()[0]==2
    finally:reopened.close()



def test_schema22_upgrade_preserves_topic_history_and_starts_visible(tmp_path):
    from pathlib import Path
    import shutil
    from legacy_garden import PreRemovalGarden
    from yorw_api.storage.database import Database
    from yorw_api.storage.workspace import Workspace
    scripts=tmp_path/'schema22';scripts.mkdir()
    for path in sorted((Path(__file__).parents[1]/'src/yorw_api/migrations').glob('*.sql'))[:22]:shutil.copy2(path,scripts/path.name)
    workspace=Workspace(tmp_path/'workspace');old=Database(workspace,scripts)
    item=create(PreRemovalGarden(old));old.close()
    upgraded=Database(workspace)
    try:
        assert upgraded.version==23
        assert Garden(upgraded).get(item['topic']['id'])==item
        assert upgraded.connection.execute('SELECT deleted_at FROM topics').fetchone()[0] is None
        assert len(list((workspace.root/'backups').glob('*.sqlite3')))==1
    finally:upgraded.close()
