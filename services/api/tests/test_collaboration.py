"""Formal adoption gates A01-A06 with owned fixtures, no external model or user DB."""
from uuid import uuid4
import json
import pytest
from fastapi import HTTPException
from test_library import library
from test_research import doc
from test_notebooks import topic, create, write
from yorw_api.collaboration import Collaboration, Preview, Operation, Decision
from yorw_api.notebooks import Notebooks
from yorw_api.garden import Garden, SaveBody
from yorw_api.relations import Relations
from yorw_api.research_tools import ResearchTools,digest


def op(key, action, **fields):
    return Operation(key=key, action=action, reason='Owned fixture organization', **fields)


def preview(service, document, operations):
    return service.preview(Preview(request_id=uuid4(), document_id=document, operations=operations))


def decision(item, selected=()):
    return Decision(request_id=uuid4(), version=item['version'], selected=list(selected))


def batch():
    return [op('topic', 'create_topic', title='Fixture research'),
            op('note', 'create_note', owner='$topic', title='Hypothesis', body_md='Unverified hypothesis, not a completed experiment.'),
            op('link', 'link', first_kind='document', first='', second_kind='topic', second='$topic')]


def test_atomic_selection_idempotency_and_undo(library):
    service=Collaboration(library); document=doc(library)
    operations=batch(); operations[2].first=document
    value=Preview(request_id=uuid4(),document_id=document,operations=operations)
    item=service.preview(value)
    assert service.preview(value)['id']==item['id']
    assert not Garden(library.db).list()['items']
    request=decision(item,['topic','note','link'])
    accepted=service.decide(item['id'],request,'accept')
    assert service.decide(item['id'],request,'accept')['status']=='accepted'
    assert len(Garden(library.db).list()['items'])==1
    note=Notebooks(library).get(item['operations'][1]['object_id'])
    assert 'Unverified' in note['body_md']
    undone=service.decide(item['id'],decision(accepted),'undo')
    assert undone['status']=='undone'
    assert not Garden(library.db).list()['items']
    assert library.rows('SELECT * FROM revisions WHERE topic_id=?',(note['id'],))


def test_A02_deselect_dependencies_keeps_independent(library):
    service=Collaboration(library); document=doc(library); owner=topic(library)
    operations=batch(); operations[2].first=document
    operations.append(op('independent','create_note',owner=owner,title='Independent',body_md='Kept'))
    item=preview(service,document,operations)
    result=service.decide(item['id'],decision(item,['note','link','independent']),'accept')
    assert result['decision']['selected']==['independent']
    assert result['decision']['skipped_dependencies']==['note','link']
    assert len(Garden(library.db).list()['items'])==1
    assert len(Notebooks(library).overview(owner)['notes'])==1


def test_A03_conflict_rolls_back_whole_selection(library):
    service=Collaboration(library); document=doc(library); owner=topic(library)
    note=create(Notebooks(library),owner)
    item=preview(service,document,[op('new','create_topic',title='Must not appear'),op('append','append_note',target=note['id'],body_md='AI candidate')])
    write(library,note,'User edit')
    with pytest.raises(HTTPException,match='PROPOSAL_STALE'):
        service.decide(item['id'],decision(item,['new','append']),'accept')
    assert len(Garden(library.db).list()['items'])==1
    assert Notebooks(library).get(note['id'])['body_md']=='User edit'
    assert service.get(item['id'])['status']=='pending'
    repaired=service.repair(item['id'],uuid4())
    assert repaired['operations'][1]['before_body']=='User edit'


def test_A04_post_adoption_edit_stops_whole_undo(library):
    service=Collaboration(library); document=doc(library); owner=topic(library)
    note=create(Notebooks(library),owner)
    item=preview(service,document,[op('append','append_note',target=note['id'],body_md='AI candidate')])
    accepted=service.decide(item['id'],decision(item,['append']),'accept')
    write(library,note,'Later manual edit')
    with pytest.raises(HTTPException,match='UNDO_CONFLICT'):
        service.decide(item['id'],decision(accepted),'undo')
    assert Notebooks(library).get(note['id'])['body_md']=='Later manual edit'


def test_A05_new_reference_blocks_undo(library):
    service=Collaboration(library); document=doc(library)
    item=preview(service,document,[op('new','create_topic',title='Referenced')])
    accepted=service.decide(item['id'],decision(item,['new']),'accept')
    with library.db.write() as conn:
        Relations(library).link_with(conn,'document',document,'topic',item['operations'][0]['object_id'])
    with pytest.raises(HTTPException,match='UNDO_DEPENDENCY'):
        service.decide(item['id'],decision(accepted),'undo')
    assert Garden(library.db).list()['items']


def test_transaction_failure_no_partial_objects(library,monkeypatch):
    service=Collaboration(library); document=doc(library)
    item=preview(service,document,[op('one','create_topic',title='One'),op('two','create_topic',title='Two')])
    original=service.apply_op
    def fail(conn,operation,*args):
        if operation['key']=='two':raise RuntimeError('fixture failure')
        return original(conn,operation,*args)
    monkeypatch.setattr(service,'apply_op',fail)
    with pytest.raises(RuntimeError):service.decide(item['id'],decision(item,['one','two']),'accept')
    assert not Garden(library.db).list()['items']
    assert service.get(item['id'])['status']=='pending'


def test_new_topic_plain_relation_does_not_expand_scope(library):
    service=Collaboration(library); a=topic(library,'A'); b=topic(library,'B')
    value=Preview(request_id=uuid4(),topic_id=a,operations=[op('related','link',first_kind='topic',first=a,second_kind='topic',second=b)])
    item=service.preview(value);service.decide(item['id'],decision(item,['related']),'accept')
    assert Relations(library).topics(a)['items'][0]['id']==b
    assert Notebooks(library).scope(a)['selected']==[a]


def test_reject_and_invalid_dependency_and_explicit_rewrite(library):
    service=Collaboration(library); document=doc(library); owner=topic(library); note=create(Notebooks(library),owner)
    with pytest.raises(HTTPException,match='INVALID_DEPENDENCY'):
        preview(service,document,[op('bad','create_note',owner='$absent',title='Bad',body_md='Never stored')])
    with pytest.raises(HTTPException,match='REWRITE_NOT_EXPLICIT'):
        preview(service,document,[op('rewrite','rewrite_note',target=note['id'],body_md='Not authorized')])
    item=preview(service,document,[op('new','create_topic',title='Reject')])
    result=service.decide(item['id'],decision(item),'reject')
    assert result['status']=='rejected'
    assert len(Garden(library.db).list()['items'])==1


def research_origin(library, owner=None):
    tid,sid=str(uuid4()),str(uuid4());scope={'mode':'topic','topic_id':owner} if owner else {'mode':'workspace'}
    with library.db.write() as conn:
        conn.execute("INSERT INTO research_sessions(id,title,scope_json,created_at,updated_at) VALUES(?,'Fixture',?,'time','time')",(sid,json.dumps(scope)))
        conn.execute("INSERT INTO research_tasks(id,session_id,request_id,request_json,question,status,scope_json,scope_version,profile_json,created_at,updated_at) VALUES(?,?,?,'{}','Organize a candidate idea','completed',?,1,'{}','time','time')",(tid,sid,str(uuid4()),json.dumps(scope)))
    return tid,sid


@pytest.mark.parametrize('change',['forget','correct','scope','delete_session'])
def test_A06_context_changes_invalidate_pending_not_formal_materials(library,change):
    service=Collaboration(library);owner=topic(library);tid,sid=research_origin(library,owner)
    item=service.preview(Preview(request_id=uuid4(),task_id=tid,operations=[op('new','create_note',owner=owner,title='Candidate',body_md='Not yet formal')]))
    with library.db.write() as conn:
        if change=='forget':conn.execute("INSERT INTO research_memory_exclusions VALUES('research',?,'time')",(tid,))
        elif change=='correct':conn.execute("UPDATE research_memory_state SET content_version=content_version+1 WHERE scope_key='global'")
        elif change=='scope':conn.execute('UPDATE research_sessions SET version=version+1 WHERE id=?',(sid,))
        else:conn.execute("UPDATE research_sessions SET deleted_at='time' WHERE id=?",(sid,))
    assert service.get(item['id'])['stale']
    with pytest.raises(HTTPException):service.decide(item['id'],decision(item,['new']),'accept')
    assert not Notebooks(library).overview(owner)['notes']


def test_A01_reparsed_source_blocks_adoption_and_keeps_original_revision(library):
    service=Collaboration(library);document=doc(library);owner=topic(library);tid,_=research_origin(library)
    tools=ResearchTools(library,{'mode':'workspace'})
    hit=tools.execute('search_local',{'query':'fixture'})['items'][0]
    source=tools.execute('read_local',{'handle':hit['handle']})
    item=service.preview(Preview(request_id=uuid4(),task_id=tid,operations=[op('note','create_note',owner=owner,title='Sourced',body_md='Fixture evidence [S1].')]),sources=[source])
    with library.db.write() as conn:conn.execute('UPDATE documents SET extraction_version=extraction_version+1 WHERE id=?',(document,))
    assert service.get(item['id'])['stale']
    with pytest.raises(HTTPException):service.decide(item['id'],decision(item,['note']),'accept')
    assert not Notebooks(library).overview(owner)['notes']


def test_sources_normalized_citations_rebased_and_safe_undo(library):
    from yorw_api.source_status import source_status
    service=Collaboration(library);document=doc(library);owner=topic(library);note=create(Notebooks(library),owner);tid,_=research_origin(library)
    tools=ResearchTools(library,{'mode':'workspace'})
    source=tools.execute('read_local',{'handle':tools.execute('search_local',{'query':'fixture'})['items'][0]['handle']})
    value=Preview(request_id=uuid4(),task_id=tid,operations=[op('append','append_note',target=note['id'],body_md='First evidence [S1].')])
    item=service.preview(value,sources=[source]);service.decide(item['id'],decision(item,['append']),'accept')
    current=Notebooks(library).get(note['id'])
    assert current['sources'][0]['available']
    value.request_id=uuid4();value.operations[0].body_md='Second evidence [S1].'
    item=service.preview(value,sources=[source]);result=service.decide(item['id'],decision(item,['append']),'accept')
    current=Notebooks(library).get(note['id'])
    assert '[S2]' in current['body_md']
    assert current['sources'][1]['source_id']=='S2'
    assert all(s['available'] for s in current['sources'])
    service.decide(item['id'],decision(result),'undo')
    assert '[S2]' not in Notebooks(library).get(note['id'])['body_md']


def test_enrichment_hidden_invalidates_new_topic_preview(library):
    service=Collaboration(library);document=doc(library)
    with library.db.write() as conn:
        extraction=library.document(document)['extraction_version']
        conn.execute("INSERT INTO document_enrichments(document_id,extraction_version,config_hash,prompt_version,result_json,coverage_json,created_at) VALUES(?,?,'fixture','fixture','{}','[]','time')",(document,extraction))
    value=Preview(request_id=uuid4(),document_id=document,enrichment_id=1,operations=[op('new','create_topic',title='Preview')])
    item=service.preview(value)
    with library.db.write() as conn:conn.execute('UPDATE document_enrichments SET hidden=1 WHERE id=1')
    assert service.get(item['id'])['stale']
    with pytest.raises(HTTPException):service.decide(item['id'],decision(item,['new']),'accept')


def test_keyword_body_candidates_empty_results_and_shared_relation_service(library):
    from io import BytesIO
    from test_library import wait
    document=doc(library);owner=topic(library,'Unrelated title');note=create(Notebooks(library),owner)
    write(library,note,'The fixture is used to analyze reliable experiments.')
    candidates=Relations(library).candidates('document',document)['items']
    assert any(r['id']==owner and r['source']['id']==document for r in candidates)
    assert not Relations(library).candidates('document',document,'zyxqnevermatches')['items']
    from yorw_api.resources import DocumentResources
    DocumentResources(library).add_document_topic(document,owner)
    assert not Relations(library).candidates('document',document)['items']


def test_research_tool_proposes_only_then_explicitly_adopts(library):
    from test_research import profile,ask,finish
    from yorw_api.research import Research
    owner=topic(library,'Owned research');pid=profile(library)
    def model(config,key,messages,schemas,validators,*args,**kwargs):
        tools=[m for m in messages if m['role']=='tool']
        if not tools:
            name='propose_changes'
            value=validators[name]({'operations':json.dumps([op('note','create_note',owner=owner,title='Research idea',body_md='Candidate hypothesis only.').model_dump()])})
            return {'role':'assistant','content':'','tool_calls':[{'id':'owned-proposal','type':'function','function':{'name':name,'arguments':json.dumps(value)}}]},[('owned-proposal',name,value)],None
        assert json.loads(tools[-1]['content'])['status']=='pending'
        return {'role':'assistant','content':'已生成预览，请选择采纳。'},[],None
    research=Research(library,model)
    try:
        result=research.start(ask(pid,'Organize a candidate idea'),'fixture')
        view=finish(research,result['session_id']);task=view['items'][0]
        assert task['status']=='completed',task
        assert not Notebooks(library).overview(owner)['notes']
        proposals=Collaboration(library).list(task_id=task['id'])['items']
        assert len(proposals)==1 and not proposals[0]['stale']
        Collaboration(library).decide(proposals[0]['id'],decision(proposals[0],['note']),'accept')
        assert Notebooks(library).overview(owner)['notes'][0]['title']=='Research idea'
    finally:research.close()


def test_28_upgrade_backup_repeat_and_immutable_history(tmp_path):
    import shutil
    from pathlib import Path
    from yorw_api.storage.workspace import Workspace
    from yorw_api.storage.database import Database
    from yorw_api.library import Library
    scripts=tmp_path/'old-migrations';scripts.mkdir()
    for path in (Path(__file__).parents[1]/'src/yorw_api/migrations').glob('*.sql'):
        if int(path.name.split('_')[0])<=28:shutil.copyfile(path,scripts/path.name)
    workspace=Workspace(tmp_path/'workspace');db=Database(workspace,scripts)
    lib=Library(db);identity=Garden(db).create(__import__('yorw_api.garden',fromlist=['CreateTopic']).CreateTopic(id=uuid4(),title='Preserved'))['topic']['id']
    before=db.connection.execute('SELECT * FROM revisions').fetchall();lib.close();db.close()
    for _ in range(2):
        db=Database(workspace)
        assert db.version==29
        assert db.connection.execute('SELECT * FROM revisions').fetchall()==before
        assert list((workspace.root/'backups').glob('*.sqlite3'))
        assert db.connection.execute('SELECT COUNT(*) FROM collaboration_proposals').fetchone()[0]==0
        db.close()


def test_candidate_version_and_duplicate_target_rejected_before_preview(library):
    service=Collaboration(library);document=doc(library);owner=topic(library)
    value=op('link','link',first_kind='document',first=document,second_kind='topic',second=owner,second_version=99)
    with pytest.raises(HTTPException,match='MATERIAL_CHANGED'):preview(service,document,[value])
    note=create(Notebooks(library),owner)
    with pytest.raises(HTTPException,match='DUPLICATE_TARGET'):
        preview(service,document,[op('a','append_note',target=note['id'],body_md='A'),op('b','append_note',target=note['id'],body_md='B')])


def test_A05_document_summary_reference_blocks_note_undo(library):
    from yorw_api.library import Metadata
    service=Collaboration(library);document=doc(library);owner=topic(library)
    item=preview(service,document,[op('new','create_note',title='Referenced note',body_md='A candidate idea.',owner=owner)])
    accepted=service.decide(item['id'],decision(item,['new']),'accept')
    current=library.document(document)
    library.update(document,Metadata(version=current['version'],summary_md='See notebook '+item['operations'][0]['object_id']))
    with pytest.raises(HTTPException,match='UNDO_DEPENDENCY'):service.decide(item['id'],decision(accepted),'undo')


def test_semantic_candidates_use_only_opted_in_matching_local_index(library):
    from io import BytesIO
    import numpy as np
    from test_library import wait
    from yorw_api.search import Search
    first=doc(library)
    from pypdf import PdfReader,PdfWriter
    from test_library import pdf_bytes
    writer=PdfWriter();writer.append(PdfReader(BytesIO(pdf_bytes())))
    writer.pages[0]['/Contents'].get_object().set_data(b'BT /F1 12 Tf 20 200 Td (Astronomy galaxies distant worlds.) Tj ET')
    writer.add_metadata({'/Title':'Astronomy','/Author':'Astronomy'})
    stream=BytesIO();writer.write(stream);stream.seek(0)
    task=library.import_pdf(stream,'astronomy.pdf');wait(library,task)
    second=task['document']['id']
    config={'kind':'embedding','base_url':'http://127.0.0.1:1','model':'fixture','version':1}
    search=Search(library)
    try:
        with library.db.write() as conn:conn.execute("INSERT INTO provider_configs(kind,base_url,model,version,updated_at) VALUES('embedding',?,'fixture',1,'time')",(config['base_url'],))
        for identity in (first,second):
            search.ensure_segments(identity)
            current=library.document(identity);generation=str(uuid4())
            with library.db.write() as conn:
                conn.execute("INSERT INTO index_generations VALUES(?,?,?,'fixture','fixture',?,2,1,'time')",(generation,identity,current['extraction_version'],json.dumps(config)))
                for segment in library.rows('SELECT id FROM search_segments WHERE document_id=?',(identity,)):
                    conn.execute('INSERT INTO embeddings VALUES(?,?,?)',(segment['id'],generation,np.array([1.,0.],dtype='<f4').tobytes()))
                conn.execute('UPDATE documents SET active_index_generation=? WHERE id=?',(generation,identity))
        with library.db.write() as conn:conn.execute('UPDATE ai_preferences SET semantic_enabled=0')
        assert not Relations(library).candidates('document',first)['items']
        with library.db.write() as conn:conn.execute('UPDATE ai_preferences SET semantic_enabled=1')
        result=Relations(library).candidates('document',first)
        assert result['mode']=='keyword+cached_semantic'
        assert result['items'][0]['id']==second and '语义接近' in result['items'][0]['reason']
    finally:search.close()


def test_rewrite_requires_named_note_and_preserves_reading_note_snapshots(library):
    from yorw_api.notes import Notes,NewNote,NoteBody
    service=Collaboration(library);document=doc(library);note=str(uuid4())
    Notes(library.db).create(NewNote(id=note,document_id=document,body_md='Original owned note'))
    tid,_=research_origin(library)
    value=Preview(request_id=uuid4(),task_id=tid,operations=[op('rewrite','rewrite_note',target=note,body_md='Explicit replacement')])
    with library.db.write() as conn:conn.execute("UPDATE research_tasks SET question='重写另一份笔记' WHERE id=?",(tid,))
    with pytest.raises(HTTPException,match='REWRITE_NOT_EXPLICIT'):service.preview(value)
    with library.db.write() as conn:conn.execute('UPDATE research_tasks SET question=? WHERE id=?',('重写笔记 '+note,tid))
    item=service.preview(value);result=service.decide(item['id'],decision(item,['rewrite']),'accept')
    assert Notes(library.db)._get(note)['body_md']=='Explicit replacement'
    assert library.rows('SELECT body_md FROM reading_note_revisions WHERE note_id=? AND version=1',(note,))[0]['body_md']=='Original owned note'
    service.decide(item['id'],decision(result),'undo')
    assert Notes(library.db)._get(note)['body_md']=='Original owned note'


def test_candidates_search_late_body_and_preserve_support_location(library):
    document=doc(library);owner=topic(library,'Different title');note=create(Notebooks(library),owner)
    write(library,note,'Preface. '+('Earlier content. '*2000)+'LateBodyMarker')
    result=Relations(library).candidates('document',document,'latebodymarker')
    assert result['items'][0]['id']==owner
    assert 'LateBodyMarker' in result['items'][0]['excerpt']
    assert result['items'][0]['support'][0]['note_id']==note['id']
