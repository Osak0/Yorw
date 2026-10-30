"""State/provenance regression; fake model output never establishes research quality."""
from io import BytesIO
import json
from threading import Event
import time
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from yorw_api.enrichment import Enrichments, Settings, Decision, ModelDocumentEnricher
from yorw_api.garden import Garden, CreateTopic, SaveBody
from yorw_api.library import Metadata, now, Library
from yorw_api.retrieval import Retriever
from yorw_api.retrieval_adapters import SQLiteNumpyVectorIndex
from yorw_api.providers import ProbeError
from test_library import library
from test_search import document


class FixtureEnricher:
    def __init__(self): self.calls=0; self.gate=None; self.entered=Event();self.fail=False
    def summarize(self,config,key,blocks,check):
        self.calls+=1;self.entered.set()
        if self.gate: assert self.gate.wait(5)
        check('SUMMARY_COMPLETE')
        if self.fail: raise ProbeError('CONNECTION_FAILED')
        return {'result':{'overview':'Synthetic lung imaging overview','method':'computed tomography','tags':['LDCT','肺部筛查'],'synonyms':['low dose CT'],'evidence_ids':[blocks[0]['id']]},'coverage':[b['id'] for b in blocks],'parts':1}


@pytest.fixture
def enrich(library):
    with library.db.write() as conn:
        conn.execute("INSERT INTO provider_configs(kind,base_url,model,version,updated_at) VALUES('chat','https://example.com/v1','fixture',1,'time')")
    fake=FixtureEnricher();service=Enrichments(library,fake)
    yield service,fake
    if fake.gate: fake.gate.set()
    service.close()


def doc(service): return document(SimpleNamespace(db=service.db),['Computed tomography finds lung nodules.'])


def settle(service,task):
    for _ in range(500):
        result=service.library.task(task['id'])
        if result['status'] not in ('queued','running'): return result
        time.sleep(.01)
    pytest.fail('enrichment timeout')


def test_opt_in_and_no_automatic_replay(enrich):
    service,fake=enrich;identity=doc(service)
    assert not service.settings()['enabled'] and service.pending()=={'items':[]}
    with pytest.raises(HTTPException,match='CONSENT_REQUIRED'):service.start(identity,'key',1,True)
    prefs=service.save_settings(Settings(enabled=True,version=1))
    with service.db.write() as conn:conn.execute('UPDATE documents SET created_at=? WHERE id=?',(now(),identity))
    assert service.pending()['items']==[identity]
    fake.fail=True
    task=settle(service,service.start(identity,'key',1,True))
    assert task['status']=='failed' and service.pending()['items']==[]
    assert 'key' not in json.dumps(task)
    with pytest.raises(HTTPException,match='CONFIG_CONFLICT'):service.save_settings(Settings(enabled=False,version=1))
    service.save_settings(Settings(enabled=False,version=prefs['version']))


def test_human_fields_remain_and_rejections_persist(enrich):
    service,fake=enrich;identity=doc(service)
    service.library.update(identity,Metadata(version=1,summary_md='Human summary',tags=['Human']))
    assert settle(service,service.start(identity,'key',1))['status']=='succeeded'
    current=service.library.document(identity)
    assert current['summary_md']=='Human summary' and current['tags']==['Human']
    view=service.view(identity)['enrichment']
    service.decide(identity,Decision(enrichment_id=view['id'],action='dismiss_tag',value='LDCT'))
    settle(service,service.start(identity,'key',1,regenerate=True))
    assert 'LDCT' not in service.view(identity)['enrichment']['result']['tags']
    view=service.view(identity)['enrichment']
    service.decide(identity,Decision(enrichment_id=view['id'],action='hide'))
    settle(service,service.start(identity,'key',1,regenerate=True))
    assert not service.view(identity)['enrichment']['hidden']
    assert service.view(identity,view['id'])['enrichment']['hidden']
    assert fake.calls==3


@pytest.mark.parametrize('mutation',['cancel','disable','edit','reparse','config','delete'])
def test_inflight_result_cannot_overwrite_changed_state(enrich,mutation):
    service,fake=enrich;identity=doc(service)
    fake.gate=Event();task=service.start(identity,'key',1)
    assert fake.entered.wait(3)
    if mutation=='cancel':service.cancel(identity)
    elif mutation=='disable':service.save_settings(Settings(enabled=False,version=1))
    elif mutation=='edit':service.library.update(identity,Metadata(version=1,summary_md='Concurrent human edit'))
    elif mutation=='reparse':
        with service.db.write() as conn:conn.execute('UPDATE documents SET extraction_version=2 WHERE id=?',(identity,))
    elif mutation=='config':
        with service.db.write() as conn:conn.execute("UPDATE provider_configs SET version=2 WHERE kind='chat'")
    else:
        with service.db.write() as conn:conn.execute('UPDATE documents SET deleted_at=? WHERE id=?',(now(),identity))
    fake.gate.set();result=settle(service,task)
    assert result['status'] in ('failed','cancelled')
    assert service.library.rows('SELECT * FROM document_enrichments')==[]
    if mutation in ('cancel','disable'):assert result['status']=='cancelled'


def test_idempotent_jobs_retry_and_keep_previous(enrich):
    service,fake=enrich;identity=doc(service)
    first=settle(service,service.start(identity,'key',1))
    assert service.start(identity,'key',1)['id']==first['id'] and fake.calls==1
    previous=service.view(identity)['enrichment']
    fake.fail=True
    assert settle(service,service.start(identity,'key',1,regenerate=True))['status']=='failed'
    assert service.view(identity)['enrichment']['id']==previous['id']
    fake.fail=False
    assert settle(service,service.start(identity,'key',1))['status']=='succeeded'


def test_topic_accept_ignore_and_no_scope_expansion(enrich):
    service,_=enrich;identity=doc(service);garden=Garden(service.db)
    topic=garden.create(CreateTopic(id=uuid4(),title='lung imaging'))['topic']
    settle(service,service.start(identity,'key',1))
    view=service.view(identity)['enrichment']
    assert view['recommendations'][0]['topic_id']==topic['id']
    assert service.library.rows('SELECT * FROM document_topics')==[]
    service.decide(identity,Decision(enrichment_id=view['id'],action='accept_topic',value=topic['id']))
    assert len(service.library.rows('SELECT * FROM document_topics'))==1
    assert service.view(identity)['enrichment']['recommendations']==[]
    other=garden.create(CreateTopic(id=uuid4(),title='lung imaging alternate'))['topic']
    service.decide(identity,Decision(enrichment_id=view['id'],action='dismiss_topic',value=other['id']))
    settle(service,service.start(identity,'key',1,regenerate=True))
    assert service.view(identity)['enrichment']['recommendations']==[]


def test_stale_results_and_metadata_return_original_scoped_evidence(enrich):
    service,_=enrich;identity=doc(service);other=doc(service)
    settle(service,service.start(identity,'key',1))
    retriever=Retriever(SimpleNamespace(db=service.db,library=service.library))
    hits=retriever.retrieve('LDCT',semantic=False,strategy='metadata')['items']
    assert hits and hits[0]['object_id']==identity
    assert hits[0]['source']['evidence'][0]['quote']=='Computed tomography finds lung nodules.'
    assert not retriever.retrieve('LDCT',document_id=other,semantic=False,strategy='metadata')['items']
    with service.db.write() as conn:conn.execute('UPDATE documents SET extraction_version=2 WHERE id=?',(identity,))
    assert service.view(identity)['enrichment']['stale']
    assert not retriever.retrieve('LDCT',semantic=False,strategy='metadata')['items']


def test_restart_marks_jobs_interrupted_not_paid_again(library):
    identity=document(SimpleNamespace(db=library.db),['Restart fixture.'])
    with library.db.write() as conn:
        conn.execute("INSERT INTO tasks(id,kind,target_id,status,stage,created_at,updated_at) VALUES(?,'enrich',?,'running','SUMMARIZING','time','time')",(str(uuid4()),identity))
    library.close();restarted=Library(library.db)
    try:assert restarted.rows("SELECT status FROM tasks WHERE kind='enrich'")[0]['status']=='interrupted'
    finally:restarted.close()


def test_long_sections_validate_support_and_bounded_coverage(monkeypatch):
    from yorw_api import enrichment
    calls=[]
    def completion(config,key,instruction,value,**kwargs):
        calls.append(value)
        ids=[b['id'] for b in value['blocks']] if 'blocks' in value else [i for p in value['sections'] for i in p['evidence_ids']]
        return {'overview':'Fixture overview','tags':['CT'],'evidence_ids':list(dict.fromkeys(ids))}
    monkeypatch.setattr(enrichment,'json_completion',completion)
    result=ModelDocumentEnricher().summarize({},'private',[{'id':'a','text':'a'*14000,'section_path':['intro']},{'id':'b','text':'b'*14000,'section_path':['results']}],lambda _:None)
    assert result['parts']==4 and set(result['coverage'])=={'a','b'} and len(calls)==5
    assert sum(len(b['text']) for c in calls if 'blocks' in c for b in c['blocks'])==28000
    monkeypatch.setattr(enrichment,'json_completion',lambda *a,**k:{'overview':'bad','evidence_ids':['invented']})
    with pytest.raises(ProbeError,match='ENRICHMENT_EVIDENCE_INVALID'):ModelDocumentEnricher().summarize({},'', [{'id':'a','text':'source','section_path':[]}],lambda _:None)


def test_bad_config_and_invalid_output(enrich):
    service,fake=enrich;identity=doc(service)
    with pytest.raises(HTTPException,match='KEY_MISSING'):service.start(identity,'',1)
    with pytest.raises(HTTPException,match='CONFIG_CHANGED'):service.start(identity,'key',2)
    fake.summarize=lambda *args:{'result':{'evidence_ids':['wrong']},'coverage':[],'parts':1}
    assert settle(service,service.start(identity,'key',1))['status']=='failed'
    assert service.library.rows('SELECT * FROM document_enrichments')==[]


def test_nonresearch_model_nulls_and_lists_are_losslessly_normalized():
    from yorw_api.enrichment import parse_result
    result=parse_result({'overview':'活动决算','research_question':None,'method':None,
                         'data':['活动名称：新生杯','预算：946.2元'],'conclusion':['仅记录费用'],
                         'limitations':None,'tags':[' 活动 ', '活动'],'synonyms':None,'evidence_ids':'real-block'}, {'real-block'})
    assert result['method']=='' and result['research_question']==''
    assert result['data']=='活动名称：新生杯\n预算：946.2元'
    assert result['tags']==['活动'] and result['synonyms']==[]
    assert result['evidence_ids']==['real-block']


def test_schema_and_support_errors_are_specific_and_do_not_save_raw_output(enrich):
    from yorw_api.enrichment import parse_result, EnrichmentError
    with pytest.raises(EnrichmentError,match='ENRICHMENT_EVIDENCE_INVALID'):
        parse_result({'overview':'内容','evidence_ids':['invented']},{'real'})
    with pytest.raises(EnrichmentError,match='ENRICHMENT_SCHEMA_INVALID') as caught:
        parse_result({'method':{'sensitive model output':'must not be persisted'},'evidence_ids':['real']},{'real'})
    assert caught.value.fields==['method']
    service,fake=enrich;identity=doc(service)
    fake.summarize=lambda *args:{'result':{'method':{'private':'raw reply'},'evidence_ids':['real']},'coverage':[],'parts':1}
    result=settle(service,service.start(identity,'private-key',1))
    assert result['error']['code']=='ENRICHMENT_SCHEMA_INVALID'
    assert result['error']['fields']==['method'] and result['error']['phase']=='PREPARING'
    assert 'private-key' not in json.dumps(result) and 'raw reply' not in json.dumps(result)
    assert service.view(identity)['enrichment'] is None


def test_protocol_failure_is_not_reported_as_docx_parse_failure(enrich,monkeypatch):
    from yorw_api import enrichment
    monkeypatch.setattr(enrichment,'json_completion',lambda *a,**k:(_ for _ in ()).throw(ProbeError('INVALID_RESPONSE')))
    service,_=enrich;identity=doc(service)
    service.enricher=ModelDocumentEnricher()
    result=settle(service,service.start(identity,'key',1))
    assert result['error']['code']=='ENRICHMENT_RESPONSE_INVALID'
    assert result['error']['phase']=='SUMMARIZING_1_OF_1'
    assert service.library.document(identity)['extraction_status']=='ready'


def test_manual_tag_deletion_and_hidden_hints_are_not_restored(enrich):
    service,_=enrich;identity=doc(service)
    service.library.update(identity,Metadata(version=1,tags=['LDCT']))
    settle(service,service.start(identity,'key',1))
    service.library.update(identity,Metadata(version=2,tags=[]))
    settle(service,service.start(identity,'key',1,regenerate=True))
    result=service.view(identity)['enrichment']
    assert 'LDCT' not in result['result']['tags']
    retriever=Retriever(SimpleNamespace(db=service.db,library=service.library))
    assert not retriever.retrieve('LDCT',semantic=False,strategy='metadata')['items']
    service.decide(identity,Decision(enrichment_id=result['id'],action='hide'))
    assert not retriever.retrieve('肺部筛查',semantic=False,strategy='metadata')['items']


def test_migration_19_preserves_human_data_and_adds_disabled_settings(tmp_path):
    from pathlib import Path
    from shutil import copy2
    from yorw_api.storage.database import Database
    from yorw_api.storage.workspace import Workspace
    migrations=Path(__file__).parents[1]/'src/yorw_api/migrations'
    previous=tmp_path/'previous';previous.mkdir()
    for script in sorted(migrations.glob('*.sql'))[:19]:copy2(script,previous/script.name)
    workspace=Workspace((tmp_path/'workspace').resolve());db=Database(workspace,previous)
    identity=str(uuid4())
    with db.write() as conn:conn.execute("INSERT INTO documents(id,sha256,original_name,summary_md,summary_source,extraction_status,created_at,updated_at) VALUES(?,?,?,'Human preserved','manual','ready','time','time')",(identity,identity,'kept.txt'))
    db.close();upgraded=Database(workspace)
    try:
        assert upgraded.version==22
        assert upgraded.connection.execute('SELECT summary_md FROM documents').fetchone()[0]=='Human preserved'
        assert upgraded.connection.execute('SELECT enabled FROM enrichment_preferences').fetchone()[0]==0
        assert upgraded.connection.execute('SELECT metadata_enabled FROM ai_preferences').fetchone()[0]==0
        assert list((workspace.root/'backups').glob('*.sqlite3'))
    finally:upgraded.close()


def test_vector_adapter_is_scoped_versioned_and_rebuildable(enrich):
    import numpy as np
    service,_=enrich;first=doc(service);second=doc(service)
    retriever=Retriever(SimpleNamespace(db=service.db,library=service.library))
    rows=retriever.prepare(None,None,lambda _:None)
    index=SQLiteNumpyVectorIndex(service.library)
    with service.db.write() as conn:
        for row in rows:index.write(conn,row['id'],'configuration-1',np.array([1.,0.],dtype='<f4'))
    allowed={r['id'] for r in rows if r['object_id']==first}
    vectors=index.load('configuration-1',allowed)
    assert set(vectors)==allowed and index.load('configuration-2',allowed)=={}
    assert set(index.query(vectors,np.array([1.,0.]),allowed))==allowed
    assert index.current(next(iter(allowed)),'configuration-1')
    with service.db.write() as conn:index.delete(conn,allowed)
    assert index.load('configuration-1',allowed)=={}
    with service.db.write() as conn:index.rebuild(conn,'configuration-1')
    assert service.library.rows('SELECT * FROM knowledge_vectors')==[]


def test_history_restore_and_explicit_canonical_metadata_adoption(enrich):
    from yorw_api.enrichment import ApplyMetadata
    service,fake=enrich;identity=doc(service)
    current=service.library.update(identity,Metadata(version=1,tags=['Human','ldct'],summary_md='Original human summary'))
    original=fake.summarize
    observed=[]
    def suggest(config,key,blocks,check):
        observed.append(config['metadata_context'])
        result=original(config,key,blocks,check)
        result['result']['metadata']={'title':'Suggested title','authors':['Author'],'year':2025}
        return result
    fake.summarize=suggest
    assert settle(service,service.start(identity,'key',1))['status']=='succeeded'
    first=service.view(identity)['enrichment']
    assert observed[0]['tags']==['Human','ldct']
    service.decide(identity,Decision(enrichment_id=first['id'],action='hide'))
    assert settle(service,service.start(identity,'key',1,regenerate=True))['status']=='succeeded'
    view=service.view(identity)
    assert len(view['history'])==2 and not view['enrichment']['hidden']
    service.decide(identity,Decision(enrichment_id=first['id'],action='restore'))
    assert service.view(identity,first['id'])['enrichment']['raw_result']['overview']=='Synthetic lung imaging overview'
    updated=service.apply_metadata(identity,ApplyMetadata(enrichment_id=first['id'],version=current['version'],fields=['tags','summary_md'],mode='append'))
    assert updated['tags']==['Human','ldct','肺部筛查']
    assert updated['summary_md']=='Original human summary\n\nSynthetic lung imaging overview'
    assert updated['summary_source']=='ai'
    assert service.library.rows('SELECT count(*) AS n FROM enrichment_applications')[0]['n']==1
    with pytest.raises(HTTPException,match='DOCUMENT_CONFLICT'):
        service.apply_metadata(identity,ApplyMetadata(enrichment_id=first['id'],version=current['version'],fields=['title'],mode='replace'))
    applied=service.apply_metadata(identity,ApplyMetadata(enrichment_id=first['id'],version=updated['version'],fields=['title','authors','year'],mode='replace'))
    assert applied['title']=='Suggested title' and applied['authors']==['Author'] and applied['year']==2025
    assert applied['metadata_source']['title']=='ai_confirmed'
    with service.db.write() as conn:conn.execute('UPDATE documents SET extraction_version=extraction_version+1 WHERE id=?',(identity,))
    with pytest.raises(HTTPException,match='MATERIAL_CHANGED'):
        service.apply_metadata(identity,ApplyMetadata(enrichment_id=first['id'],version=applied['version'],fields=['title'],mode='replace'))
    service.decide(identity,Decision(enrichment_id=first['id'],action='hide'))
    service.decide(identity,Decision(enrichment_id=first['id'],action='restore'))
    assert service.view(identity,first['id'])['enrichment']['stale']


def test_history_is_document_scoped_and_failed_apply_is_atomic(enrich):
    from yorw_api.enrichment import ApplyMetadata
    service,_=enrich;identity=doc(service)
    settle(service,service.start(identity,'key',1))
    item=service.view(identity)['enrichment']
    other=document(SimpleNamespace(db=service.db),['A distinct self-authored source.'])
    with pytest.raises(HTTPException,match='ENRICHMENT_NOT_FOUND'):service.view(other,item['id'])
    before=service.library.document(identity)
    with pytest.raises(HTTPException,match='INVALID_INPUT'):
        service.apply_metadata(identity,ApplyMetadata(enrichment_id=item['id'],version=before['version'],fields=['summary_md','relative_path'],mode='replace'))
    assert service.library.document(identity)==before
    assert not service.library.rows('SELECT * FROM enrichment_applications')


def test_schema21_hidden_results_migrate_without_losing_original_outputs(tmp_path):
    from shutil import copy2
    from pathlib import Path
    from yorw_api.storage.database import Database
    from yorw_api.storage.workspace import Workspace
    previous=tmp_path/'previous';previous.mkdir()
    for script in sorted((Path(__file__).parents[1]/'src/yorw_api/migrations').glob('*.sql'))[:21]:copy2(script,previous/script.name)
    workspace=Workspace((tmp_path/'workspace').resolve());old=Database(workspace,previous)
    identity=str(uuid4());raw={'overview':'Legacy original summary','tags':['Legacy'],'synonyms':[],'evidence_ids':['saved-block']}
    with old.write() as conn:
        conn.execute("INSERT INTO documents(id,sha256,original_name,summary_md,extraction_status,created_at,updated_at) VALUES(?,?,?,'Preserved metadata','ready','time','time')",(identity,identity,'legacy.txt'))
        extraction=conn.execute('SELECT extraction_version FROM documents WHERE id=?',(identity,)).fetchone()[0]
        for _ in range(2):conn.execute("INSERT INTO document_enrichments(document_id,extraction_version,config_hash,prompt_version,result_json,coverage_json,created_at) VALUES(?,?,'old','v2',?,'[]','time')",(identity,extraction,json.dumps(raw)))
        conn.execute('INSERT INTO enrichment_decisions VALUES(?,?,?)',(identity,extraction,'hide'))
    old.close();db=Database(workspace);library=Library(db);service=Enrichments(library)
    try:
        assert len(service.view(identity)['history'])==2
        assert service.view(identity)['enrichment']['hidden']
        service.decide(identity,Decision(enrichment_id=1,action='restore'))
        restored=service.view(identity,1)['enrichment']
        assert restored['raw_result']==raw and not restored['hidden']
        assert service.view(identity,2)['enrichment']['hidden']
        assert library.document(identity)['summary_md']=='Preserved metadata'
    finally:service.close();library.close();db.close()
