import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import pytest
from fastapi import HTTPException
from yorw_api.wiki_review import WikiReview,Accept,Decision
from yorw_api.garden import SaveBody,CreateTopic
from test_suggestions import service,setup,settle
from test_library import library


def generated(service,monkeypatch):
    doc,topic,args=setup(service)
    monkeypatch.setattr('yorw_api.suggestions.stream',lambda *a,**k:iter(['# Draft\n\nFact [S1]']))
    item=settle(service,service.generate(topic,args,'key'))
    return doc,topic,item,WikiReview(service)


def test_accept_edited_body_preserves_snapshots_and_retry_never_rewinds(service,monkeypatch):
    _,topic,item,review=generated(service,monkeypatch)
    value=Accept(request_id=uuid4(),base_revision_id=item['base_revision_id'],body_md='# 人工核查\n\nEdited fact [S1]')
    before=service.db.connection.execute('SELECT sources_json FROM suggestions WHERE id=?',(item['id'],)).fetchone()[0]
    result=review.decide(item['id'],value,True)
    accepted=result['view']['revision']
    assert accepted['ordinal']==2 and accepted['origin']=='ai_accepted' and accepted['body_md']==value.body_md
    assert service.db.connection.execute('SELECT sources_json FROM revisions WHERE id=?',(accepted['id'],)).fetchone()[0]==before
    assert service.get(item['id'])['body_md']==item['body_md']
    assert service.get(item['id'])['decision']=={'action':'accept','revision_id':accepted['id']}
    newer=service.garden.save(topic,SaveBody(base_revision_id=accepted['id'],body_md='New manual [S1]'))
    retry=review.decide(item['id'],value,True)
    assert retry['view']==newer and retry['decision']['revision_id']==accepted['id']
    assert len(service.garden.history(topic)['items'])==3
    with pytest.raises(HTTPException) as error:review.decide(item['id'],value.model_copy(update={'request_id':uuid4()}),True)
    assert error.value.detail=='SUGGESTION_DECIDED'
    with pytest.raises(HTTPException) as error:review.decide(item['id'],value.model_copy(update={'body_md':'other [S1]'}),True)
    assert error.value.detail=='REQUEST_CONFLICT'


@pytest.mark.parametrize('mode',['base','material','invalid','missing','failed'])
def test_accept_guards_cannot_write_any_revision(service,monkeypatch,mode):
    doc,topic,item,review=generated(service,monkeypatch)
    base=item['base_revision_id'];body='Edited [S1]'
    if mode=='base':base=service.garden.save(topic,SaveBody(base_revision_id=base,body_md='changed'))['revision']['id']
    if mode=='material':
        with service.db.write() as conn:conn.execute("UPDATE documents SET deleted_at='now' WHERE id=?",(doc,))
    if mode=='failed':
        with service.db.write() as conn:conn.execute("UPDATE suggestions SET status='failed' WHERE id=?",(item['id'],))
    if mode=='invalid':body='Invented [S999]'
    if mode=='missing':body='Without citations'
    before=service.garden.get(topic)
    with pytest.raises(HTTPException):review.decide(item['id'],Accept(request_id=uuid4(),base_revision_id=base,body_md=body),True)
    assert service.garden.get(topic)==before
    assert service.db.connection.execute('SELECT count(*) FROM wiki_decisions').fetchone()[0]==0


def test_reject_stale_suggestion_is_persistent_and_does_not_modify_body(service,monkeypatch):
    _,topic,item,review=generated(service,monkeypatch)
    saved=service.garden.save(topic,SaveBody(base_revision_id=item['base_revision_id'],body_md='new body'))
    value=Decision(request_id=uuid4(),base_revision_id=saved['revision']['id'])
    assert review.decide(item['id'],value,False)['view']==saved
    assert review.decide(item['id'],value,False)['decision']['action']=='reject'
    assert service.get(item['id'])['decision']['action']=='reject'
    assert len(service.garden.history(topic)['items'])==2


def test_restore_creates_revision_and_preserves_unavailable_source_history(service,monkeypatch):
    doc,topic,item,review=generated(service,monkeypatch)
    accepted=review.decide(item['id'],Accept(request_id=uuid4(),base_revision_id=item['base_revision_id'],body_md=item['body_md']),True)['view']['revision']
    newer=service.garden.save(topic,SaveBody(base_revision_id=accepted['id'],body_md='manual update'))['revision']
    with service.db.write() as conn:conn.execute("UPDATE documents SET deleted_at='now' WHERE id=?",(doc,))
    value=Decision(request_id=uuid4(),base_revision_id=newer['id'])
    restored=review.restore(topic,accepted['id'],value)['view']['revision']
    assert restored['ordinal']==4 and restored['origin']=='restore' and restored['restored_from_id']==accepted['id']
    assert restored['body_md']==accepted['body_md'] and not restored['sources'][0]['available']
    raw=lambda rid:service.db.connection.execute('SELECT sources_json FROM revisions WHERE id=?',(rid,)).fetchone()[0]
    assert raw(restored['id'])==raw(accepted['id'])
    assert review.restore(topic,accepted['id'],value)['view']['revision']['id']==restored['id']
    with pytest.raises(HTTPException):review.restore(topic,item['base_revision_id'],value)
    other=service.garden.create(CreateTopic(id=uuid4(),title='Other'))
    with pytest.raises(HTTPException):review.restore(topic,other['revision']['id'],Decision(request_id=uuid4(),base_revision_id=restored['id']))
    with pytest.raises(HTTPException):review.restore(topic,accepted['id'],Decision(request_id=uuid4(),base_revision_id=newer['id']))
    assert len(service.garden.history(topic)['items'])==4


def test_atomic_rollback_and_concurrent_decisions(service,monkeypatch):
    _,topic,item,review=generated(service,monkeypatch)
    value=Accept(request_id=uuid4(),base_revision_id=item['base_revision_id'],body_md=item['body_md'])
    before=service.garden.get(topic)
    with service.db.write() as conn:conn.execute("CREATE TRIGGER reject_decision BEFORE INSERT ON wiki_decisions BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
    with pytest.raises(sqlite3.IntegrityError):review.decide(item['id'],value,True)
    assert service.garden.get(topic)==before and len(service.garden.history(topic)['items'])==1
    with service.db.write() as conn:conn.execute('DROP TRIGGER reject_decision')
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:review.decide(item['id'],value,True),range(2)))
    assert results[0]==results[1] and len(service.garden.history(topic)['items'])==2


def test_schema8_upgrade_preserves_existing_suggestions_and_revisions(tmp_path):
    from pathlib import Path
    import shutil
    from yorw_api.storage.database import Database
    from yorw_api.storage.workspace import Workspace
    from yorw_api.garden import Garden
    scripts=tmp_path/'schema8';scripts.mkdir()
    for file in sorted((Path(__file__).parents[1]/'src/yorw_api/migrations').glob('*.sql'))[:8]:shutil.copy2(file,scripts/file.name)
    workspace=Workspace(tmp_path/'workspace');old=Database(workspace,scripts)
    topic=Garden(old).create(CreateTopic(id=uuid4(),title='Existing topic'))
    sid,task=str(uuid4()),str(uuid4())
    with old.write() as conn:
        conn.execute("INSERT INTO tasks(id,kind,status,stage,created_at,updated_at) VALUES(?,'suggestion','succeeded','DRAFT_READY','time','time')",(task,))
        conn.execute("INSERT INTO suggestions(id,topic_id,base_revision_id,base_body_md,instruction,body_md,sources_json,materials_json,request_json,provider_snapshot_json,prompt_version,status,request_id,task_id,created_at) VALUES(?,?,?,'','instruction','Retained draft [S1]','[]','[]','{}','{}','v1','completed',?,?,'time')",(sid,topic['topic']['id'],topic['revision']['id'],str(uuid4()),task))
    old.close();updated=Database(workspace)
    try:
        assert updated.version==16 and Garden(updated).get(topic['topic']['id'])==topic
        assert updated.connection.execute('SELECT body_md FROM suggestions WHERE id=?',(sid,)).fetchone()[0]=='Retained draft [S1]'
        assert updated.connection.execute('SELECT count(*) FROM wiki_decisions').fetchone()[0]==0
        assert updated.connection.execute('PRAGMA foreign_key_check').fetchall()==[]
    finally:updated.close()


@pytest.mark.parametrize('status,code', [('partial', 'OUTPUT_TRUNCATED'), ('failed', 'OUTPUT_TRUNCATED'),
                                       ('failed', 'STREAM_INTERRUPTED'), ('interrupted', 'INTERRUPTED'),
                                       ('cancelled', 'CANCELLED')])
def test_repair_partial_and_legacy_failed_drafts_preserves_original_record(service, monkeypatch, status, code):
    _, topic, item, review = generated(service, monkeypatch)
    with service.db.write() as conn:
        conn.execute('UPDATE suggestions SET status=?,error_code=? WHERE id=?', (status, code, item['id']))
    assert service.get(item['id'])['recoverable']
    original_sources = service.db.connection.execute('SELECT sources_json FROM suggestions WHERE id=?', (item['id'],)).fetchone()[0]
    request = Accept(request_id=uuid4(), base_revision_id=item['base_revision_id'], body_md='Manually completed [S1].')
    accepted = review.decide(item['id'], request, True)
    assert accepted['view']['revision']['body_md'] == request.body_md
    saved_sources = service.db.connection.execute('SELECT sources_json FROM revisions WHERE id=?', (accepted['view']['revision']['id'],)).fetchone()[0]
    assert saved_sources == original_sources
    retained = service.get(item['id'])
    assert retained['status'] == status and retained['error_code'] == code and retained['body_md'] == item['body_md']
    assert review.decide(item['id'], request, True) == accepted
    assert len(service.garden.history(topic)['items']) == 2


@pytest.mark.parametrize('guard', ['empty', 'running', 'source', 'base', 'invalid'])
def test_partial_recovery_keeps_all_save_guards(service, monkeypatch, guard):
    doc, topic, item, review = generated(service, monkeypatch)
    with service.db.write() as conn:
        conn.execute("UPDATE suggestions SET status='partial',error_code='OUTPUT_TRUNCATED' WHERE id=?", (item['id'],))
        if guard == 'empty':
            conn.execute("UPDATE suggestions SET body_md='' WHERE id=?", (item['id'],))
        if guard == 'running':
            conn.execute("UPDATE suggestions SET status='running' WHERE id=?", (item['id'],))
        if guard == 'source':
            conn.execute("UPDATE documents SET deleted_at='now' WHERE id=?", (doc,))
    if guard == 'base':
        service.garden.save(topic, SaveBody(base_revision_id=item['base_revision_id'], body_md='New revision'))
    before = service.garden.get(topic)
    with pytest.raises(HTTPException):
        review.decide(item['id'], Accept(request_id=uuid4(), base_revision_id=item['base_revision_id'],
                                        body_md='Edited [S999]' if guard == 'invalid' else 'Edited [S1]'), True)
    assert service.garden.get(topic) == before
