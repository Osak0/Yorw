"""R1 read tools: one tool contract, Storage directories and scope isolation.

All fixtures are generated in temporary workspaces; no user database or paper is read.
"""
import json
from uuid import uuid4, UUID

import pytest
from fastapi import HTTPException

from test_library import library
from test_notebooks import create as create_note
from test_research import ask, finish, profile
from yorw_api.collaboration import Collaboration, Decision, FolderDependency, Operation, Preview
from yorw_api.folders import Folders, Change
from yorw_api.garden import Garden, CreateTopic
from yorw_api.notebooks import Notebooks
from yorw_api.relations import Relations
from yorw_api.research import Research
from yorw_api.research_tools import ResearchTools
from yorw_api.tool_errors import ToolFault
from yorw_api.providers import ProbeError


def make_folder(library, name, parent=None):
    before={row['id'] for row in Folders(library).list()['items']}
    Folders(library).save(Change(name=name,parent_id=UUID(parent) if parent else None))
    return next(row['id'] for row in Folders(library).list()['items'] if row['id'] not in before)


def make_document(library, name, folder=None, *, title=None, extraction='ready',
                  parse='ready', warning=None):
    identity=str(uuid4())
    with library.db.write() as conn:
        conn.execute("INSERT INTO documents(id,sha256,original_name,title,authors_json,year,metadata_source_json,page_count,extraction_status,extraction_version,last_page,version,created_at,updated_at,folder_id,format,media_type,parse_version,parse_status,parse_warning) VALUES(?,?,?,?,'[]',NULL,'{}',1,?,1,1,1,'time','time',?,'txt','text/plain',1,?,?)",
                     (identity,identity,name,title,extraction,folder,parse,warning))
    return identity


def link(library, document, topic):
    with library.db.write() as conn:
        conn.execute('INSERT INTO document_topics(document_id,topic_id,created_at) VALUES(?,?,?)',(document,topic,'time'))


def add_block(library, document, text='fixture evidence'):
    with library.db.write() as conn:
        conn.execute("INSERT INTO document_blocks(id,document_id,extraction_version,ordinal,block_type,text,section_path_json,physical_page,location_json) VALUES(?,?,1,1,'paragraph',?,'[]',1,'{}')",(str(uuid4()),document,text))


def make_topic(library, title):
    return Garden(library.db).create(CreateTopic(id=uuid4(),title=title,parent_id=None))['topic']['id']


def test_tool_registry_is_single_source(library):
    tools = ResearchTools(library, {'mode': 'workspace'})
    schemas = tools.schemas()
    names = [item['function']['name'] for item in schemas]
    assert len(names) == len(set(names))
    assert {'search_local', 'read_local', 'inspect_scope', 'find_relations'} <= set(names)
    for item in schemas:
        name = item['function']['name']
        spec = tools.registry.get(name)
        assert spec.schema() == item
        assert callable(spec.validate) and callable(spec.execute)
    with pytest.raises(KeyError):
        tools.registry.get('unknown_tool')
    with pytest.raises(ToolFault):
        tools.registry.validate('search_local', {'query': 'fixture', 'extra': True})


def test_all_read_results_carry_type_version_owner_and_navigation(library):
    document=make_document(library,'证据.txt')
    add_block(library,document,'fixture evidence')
    topic=make_topic(library,'负责人专题')
    note={'id':str(uuid4())}
    with library.db.write() as conn:
        conn.execute('INSERT INTO notes(id,document_id,body_md,created_at,updated_at) VALUES(?,?,?,?,?)',(note['id'],document,'fixture note','time','time'))
        Relations(library).link_with(conn,'document',document,'topic',topic)
    tools=ResearchTools(library,{'mode':'workspace'})
    window=tools.execute('inspect_scope',{})
    assert window['documents'][0]['kind']=='document'
    assert window['documents'][0]['navigation']['id']==document
    assert window['topics'][0]['navigation']['tab']=='topic'
    assert window['notes'][0]['navigation']['tab']=='notes'
    found=next(item for item in tools.execute('search_local',{'query':'fixture'})['items'] if item['kind']=='document')
    assert found['id']==document and found['version']=='1'
    assert found['navigation']=={'module':'Storage','tab':'document','id':document,'title':found['title']}
    source=tools.execute('read_local',{'handle':found['handle']})
    assert source['navigation']['id']==document and source['navigation']['tab']=='document'
    candidates=tools.execute('find_relations',{'kind':'document','id':document,'query':'fixture'})
    assert all(item['navigation']['id']==item['id'] for item in candidates['items'])


def test_browse_lists_directory_tree_and_four_files(library):
    root=make_folder(library,'新生杯')
    settlement=make_folder(library,'决算单',root)
    invoices=make_folder(library,'发票',root)
    documents={make_document(library,name,settlement) for name in ('决算单一.txt','决算单二.txt')}
    documents|={make_document(library,name,invoices) for name in ('发票一.txt','发票二.txt')}
    tools=ResearchTools(library,{'mode':'workspace'})
    top=tools.execute('browse_library',{'folder_id':root})
    assert top['state']=='ok' and top['total']==2
    assert [item['name'] for item in top['items']]==['决算单','发票']
    all_items=[]
    for child in top['items']:
        assert child['kind']=='folder' and child['path'] in ('新生杯/决算单','新生杯/发票')
        page=tools.execute('browse_library',{'folder_id':child['id']})
        assert page['total']==2
        all_items+=page['items']
    assert {item['id'] for item in all_items}==documents
    for item in all_items:
        assert item['kind']=='document' and item['path'].startswith('新生杯/')
        assert item['navigation']['module']=='Storage' and item['navigation']['tab']=='document'
        assert item['navigation']['id']==item['id']
        assert item['version']==1 and item['folder_id'] in (settlement,invoices)
    recursive=tools.execute('browse_library',{'folder_id':root,'recursive':True,'page_size':50})
    records={item['id']:item for item in recursive['items'] if item['kind']=='document'}
    assert set(records)==documents and recursive['total']==6
    assert records[list(documents)[0]]['path'].count('/')>=2


def test_same_name_directories_and_files_are_disambiguated_by_path(library):
    first=make_folder(library,'甲')
    second=make_folder(library,'乙')
    a=make_folder(library,'材料',first)
    b=make_folder(library,'材料',second)
    da=make_document(library,'发票.pdf',a,title='发票')
    db=make_document(library,'发票.pdf',b,title='发票')
    tools=ResearchTools(library,{'mode':'workspace'})
    page_a=tools.execute('browse_library',{'folder_id':a})['items'][0]
    page_b=tools.execute('browse_library',{'folder_id':b})['items'][0]
    assert page_a['id']!=page_b['id']
    assert page_a['path']=='甲/材料/发票.pdf' and page_b['path']=='乙/材料/发票.pdf'
    found=tools.execute('search_library',{'query':'材料'})
    assert {item['path'] for item in found['items'] if item['kind']=='folder'}=={'甲/材料','乙/材料'}
    found=tools.execute('search_library',{'query':'发票.pdf','kind':'document'})
    assert {item['path'] for item in found['items']}=={page_a['path'],page_b['path']}
    assert all('document_filename' in item['match_types'] for item in found['items'])


def test_browse_paginates_at_fifty_and_reports_next_page(library):
    folder=make_folder(library,'大量材料')
    documents={make_document(library,f'文件{i:02d}.txt',folder) for i in range(52)}
    tools=ResearchTools(library,{'mode':'workspace'})
    first=tools.execute('browse_library',{'folder_id':folder})
    assert first['page_size']==50 and first['page']==1
    assert len(first['items'])==50 and first['total']==52 and first['next_page']==2
    second=tools.execute('browse_library',{'folder_id':folder,'page':2})
    assert len(second['items'])==2 and second['next_page'] is None
    assert {item['id'] for item in first['items']+second['items']}==documents


def test_unparsed_empty_directory_and_empty_scope_are_distinct(library):
    folder=make_folder(library,'待整理')
    unparsed=make_document(library,'扫描件.pdf',folder,extraction='failed',parse='failed',warning='PDF_PARSE_FAILED')
    tools=ResearchTools(library,{'mode':'workspace'})
    item=tools.execute('browse_library',{'folder_id':folder})['items'][0]
    assert item['id']==unparsed and item['parse_status']=='failed'
    assert item['parse_warning']=='PDF_PARSE_FAILED' and item['body_readable'] is False
    empty=make_folder(library,'空目录')
    state=tools.execute('browse_library',{'folder_id':empty})
    assert state['items']==[] and state['total']==0 and state['state']=='empty'
    topic=make_topic(library,'无材料专题')
    scoped=ResearchTools(library,{'mode':'topic','topic_id':topic})
    status=scoped.execute('browse_library',{})
    assert status['state']=='scope_empty' and status['items']==[] and status['total']==0


def test_directories_and_topics_are_separate_objects(library):
    folder=make_folder(library,'同名研究')
    topic=make_topic(library,'同名研究')
    tools=ResearchTools(library,{'mode':'workspace'})
    listed=tools.execute('browse_library',{})['items']
    assert [(item['kind'],item['id']) for item in listed]==[('folder',folder)]
    detail=tools.execute('inspect_topic',{'id':topic})
    assert detail['kind']=='topic' and detail['id']==topic and detail['title']=='同名研究'


def test_topic_scope_hides_other_branches_names_and_counts(library):
    parent=make_folder(library,'项目')
    visible=make_folder(library,'可见分支',parent)
    hidden=make_folder(library,'隐藏分支',parent)
    visible_doc=make_document(library,'可见材料.txt',visible)
    hidden_doc=make_document(library,'隐藏材料.txt',hidden)
    topic=make_topic(library,'当前分支')
    other=make_topic(library,'其他分支')
    link(library,visible_doc,topic);link(library,hidden_doc,other)
    tools=ResearchTools(library,{'mode':'topic','topic_id':topic})
    root=tools.execute('browse_library',{})
    assert [item['id'] for item in root['items']]==[parent]
    assert root['items'][0]['document_count']==1
    inside=tools.execute('browse_library',{'folder_id':parent})
    assert [item['id'] for item in inside['items']]==[visible]
    assert inside['total']==1
    with pytest.raises(ToolFault,match='OBJECT_NOT_FOUND'):
        tools.execute('browse_library',{'folder_id':hidden})
    assert tools.execute('search_library',{'query':'隐藏材料'})['items']==[]
    assert tools.execute('search_library',{'query':'隐藏分支'})['items']==[]
    with pytest.raises(ToolFault,match='OBJECT_NOT_FOUND'):
        tools.execute('inspect_document',{'id':hidden_doc})
    with pytest.raises(ToolFault,match='OBJECT_NOT_FOUND'):
        tools.execute('browse_library',{'folder_id':str(uuid4())})


def test_document_detail_reports_folder_metadata_notes_relations_and_navigation(library):
    folder=make_folder(library,'资料')
    document=make_document(library,'原文.pdf',folder,title='正式标题')
    related=make_document(library,'相关.pdf',folder)
    topic=make_topic(library,'材料专题')
    note={'id':str(uuid4())}
    with library.db.write() as conn:
        conn.execute('INSERT INTO notes(id,document_id,body_md,created_at,updated_at) VALUES(?,?,?,?,?)',(note['id'],document,'阅读记录','time','time'))
        conn.execute("UPDATE documents SET authors_json='[\"作者\"]',year=2026,summary_md=? WHERE id=?",('文献总结',document))
        conn.execute('INSERT INTO document_tags(document_id,tag_key,tag,created_at) VALUES(?,?,?,?)',(document,'fixture','示例','time'))
        conn.execute("INSERT INTO document_relations(low_id,high_id,description,created_at,updated_at) VALUES(?,?,?,'time','time')",(min(document,related),max(document,related),'相关说明'))
        Relations(library).link_with(conn,'document',document,'topic',topic)
    tools=ResearchTools(library,{'mode':'workspace'})
    detail=tools.execute('inspect_document',{'id':document})
    assert detail['title']=='正式标题' and detail['original_name']=='原文.pdf'
    assert detail['folder']['id']==folder and detail['folder']['path']=='资料'
    assert detail['metadata']['authors']==['作者'] and detail['metadata']['year']==2026
    assert detail['metadata']['tags']==['示例'] and detail['metadata']['summary_md']=='文献总结'
    assert detail['parse']['status']=='ready' and detail['parse']['body_state']=='empty'
    assert [item['id'] for item in detail['notes']]==[note['id']]
    assert detail['notes'][0]['navigation']['tab']=='notes'
    assert [item['id'] for item in detail['relations']['documents']]==[related]
    assert [item['id'] for item in detail['relations']['topics']]==[topic]
    assert detail['navigation']=={'module':'Storage','tab':'document','id':document,'title':'正式标题'}
    assert 'text' not in detail and 'body_md' not in detail


def test_topic_detail_reports_structure_notes_materials_relations_and_scope(library):
    parent=make_topic(library,'父专题')
    child=make_topic(library,'子专题')
    with library.db.write() as conn:
        conn.execute('UPDATE topics SET parent_id=? WHERE id=?',(parent,child))
    sibling=make_topic(library,'并列专题')
    note=create_note(Notebooks(library),parent,'专题笔记')
    folder=make_folder(library,'材料目录')
    material=make_document(library,'材料.txt',folder)
    link(library,material,parent)
    with library.db.write() as conn:Relations(library).link_with(conn,'topic',parent,'topic',sibling)
    tools=ResearchTools(library,{'mode':'workspace'})
    detail=tools.execute('inspect_topic',{'id':parent})
    assert detail['path']=='父专题' and detail['path_restricted'] is False
    assert [item['id'] for item in detail['children']]==[child]
    assert detail['notes'][0]['id']==note['id'] and detail['notes'][0]['owner_topic_id']==parent
    assert [item['id'] for item in detail['materials']]==[material]
    assert [item['id'] for item in detail['relations']]==[sibling]
    assert set(detail['scope']['selected'])=={parent,child}
    assert detail['navigation']['tab']=='topic'
    scoped=ResearchTools(library,{'mode':'topic','topic_id':child})
    restricted=scoped.execute('inspect_topic',{'id':child})
    assert restricted['path']=='子专题' and restricted['path_restricted'] is True


def research_origin(library, owner=None):
    tid,sid=str(uuid4()),str(uuid4());scope={'mode':'topic','topic_id':owner} if owner else {'mode':'workspace'}
    with library.db.write() as conn:
        conn.execute("INSERT INTO research_sessions(id,title,scope_json,created_at,updated_at) VALUES(?,'Fixture',?,'time','time')",(sid,json.dumps(scope)))
        conn.execute("INSERT INTO research_tasks(id,session_id,request_id,request_json,question,status,scope_json,scope_version,profile_json,created_at,updated_at) VALUES(?,?,?,'{}','Organize a candidate idea','completed',?,1,'{}','time','time')",(tid,sid,str(uuid4()),json.dumps(scope)))
    return tid,sid


def test_proposal_status_is_session_bound_and_live(library):
    tid,sid=research_origin(library)
    service=Collaboration(library)
    item=service.preview(Preview(request_id=uuid4(),task_id=tid,operations=[Operation(key='new',action='create_topic',title='方案专题',reason='用户明确要求')]))
    tools=ResearchTools(library,{'mode':'workspace'},session_id=sid,task_id=tid)
    listing=tools.execute('inspect_proposals',{})
    assert listing['state']=='ok' and [row['id'] for row in listing['items']]==[item['id']]
    assert listing['items'][0]['status']=='pending' and listing['items'][0]['stale'] is False
    assert listing['items'][0]['origin']=={'task_id':tid}
    detail=tools.execute('inspect_proposals',{'proposal_id':item['id']})
    assert detail['proposal']['operations']==[{'key':'new','action':'create_topic','title':'方案专题','object_id':item['operations'][0]['object_id'],'depends_on':[]}]
    with library.db.write() as conn:conn.execute('UPDATE research_sessions SET version=version+1 WHERE id=?',(sid,))
    assert tools.execute('inspect_proposals',{'proposal_id':item['id']})['proposal']['stale'] is True
    other_tid,_=research_origin(library)
    other=service.preview(Preview(request_id=uuid4(),task_id=other_tid,operations=[Operation(key='new',action='create_topic',title='其他方案',reason='用户明确要求')]))
    with pytest.raises(ToolFault,match='OBJECT_NOT_FOUND'):
        tools.execute('inspect_proposals',{'proposal_id':other['id']})
    assert other['id'] not in {row['id'] for row in tools.execute('inspect_proposals',{})['items']}
    assert ResearchTools(library,{'mode':'workspace'}).execute('inspect_proposals',{})['state']=='no_session'


def links_to(folder, topic_key='topic'):
    return [Operation(key='topic',action='create_topic',title='新生杯',reason='用户明确要求')]+[
        Operation(key='doc'+str(index),action='link',first_kind='document',first=identity,
                  second_kind='topic',second='$'+topic_key,reason='指定材料')
        for index,identity in enumerate(folder)]


def test_specified_material_links_survive_unrelated_directory_growth(library):
    folder=make_folder(library,'指定材料')
    first=make_document(library,'一.txt',folder)
    second=make_document(library,'二.txt',folder)
    tid,_=research_origin(library)
    service=Collaboration(library)
    item=service.preview(Preview(request_id=uuid4(),task_id=tid,operations=links_to([first,second])))
    make_document(library,'后来新增.txt',folder)
    assert service.get(item['id'])['stale'] is False


def test_all_member_dependency_invalidates_on_membership_change(library):
    folder=make_folder(library,'全部成员')
    make_document(library,'一.txt',folder)
    tid,_=research_origin(library)
    service=Collaboration(library)
    item=service.preview(Preview(request_id=uuid4(),task_id=tid,
        operations=[Operation(key='new',action='create_topic',title='目录专题',reason='依据目录全部成员')],
        dependencies=[FolderDependency(folder_id=UUID(folder))]))
    assert service.get(item['id'])['stale'] is False
    assert service.get(item['id'])['dependencies']==[{'folder_id':folder,'name':'全部成员','path':'全部成员','version':1,'member_count':1}]
    make_document(library,'新增.txt',folder)
    assert service.get(item['id'])['stale'] is True


def test_all_member_dependency_invalidates_on_directory_rename(library):
    folder=make_folder(library,'旧目录名')
    make_document(library,'一.txt',folder)
    tid,_=research_origin(library)
    service=Collaboration(library)
    item=service.preview(Preview(request_id=uuid4(),task_id=tid,
        operations=[Operation(key='new',action='create_topic',title='目录专题',reason='依据目录名称')],
        dependencies=[FolderDependency(folder_id=UUID(folder))]))
    record=next(row for row in Folders(library).list()['items'] if row['id']==folder)
    Folders(library).save(Change(name='新目录名',version=record['version']),folder)
    assert service.get(item['id'])['stale'] is True
    assert service.get(item['id'])['dependencies'][0]['name']=='旧目录名'


def test_folder_dependency_must_be_visible_in_topic_scope(library):
    topic=make_topic(library,'当前专题')
    visible=make_folder(library,'可见目录')
    link(library,make_document(library,'可见.txt',visible),topic)
    hidden=make_folder(library,'范围外目录')
    make_document(library,'范围外.txt',hidden)
    tid,_=research_origin(library,topic)
    service=Collaboration(library)
    with pytest.raises(HTTPException,match='OUT_OF_SCOPE'):
        service.preview(Preview(request_id=uuid4(),task_id=tid,
            operations=[Operation(key='new',action='create_topic',title='不可见目录',reason='越界')],
            dependencies=[FolderDependency(folder_id=UUID(hidden))]))


def test_research_loop_browses_four_files_and_records_proposal_dependency(library):
    root=make_folder(library,'新生杯')
    settlement=make_folder(library,'决算单',root)
    invoices=make_folder(library,'发票',root)
    documents={make_document(library,name,settlement) for name in ('决算单一.txt','决算单二.txt')}
    documents|={make_document(library,name,invoices) for name in ('发票一.txt','发票二.txt')}
    pid=profile(library);schemas_seen=set();results=[]
    def turn(config,key,messages,schemas,validators,stop,deadline,max_tokens,**kwargs):
        schemas_seen.update(item['function']['name'] for item in schemas)
        calls=[message for message in messages if message['role']=='tool']
        if not calls:
            name,args='browse_library',{'folder_id':root,'recursive':True}
        elif len(calls)==1:
            found=[item for item in json.loads(calls[-1]['content'])['items'] if item['kind']=='document']
            assert {item['id'] for item in found}==documents
            name,args='propose_changes',{'operations':json.dumps([{'key':'topic','action':'create_topic','title':'新生杯整理','reason':'用户明确要求整理'}]),
                                         'dependencies':[{'folder_id':root}]}
        else:
            results.append(json.loads(calls[-1]['content']))
            return {'role':'assistant','content':'已列出四份文件并生成方案 '+results[-1]['proposal_id']},[],None
        value=validators[name](args)
        identity='call-'+str(len(calls))
        return {'role':'assistant','content':'','tool_calls':[{'id':identity,'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]},[(identity,name,value)],None
    service=Research(library,turn)
    try:
        started=service.start(ask(pid,'整理新生杯目录'),'fixture');view=finish(service,started['session_id'])
        assert view['items'][0]['status']=='completed',view['items'][0]
        assert {'browse_library','search_library','inspect_document','inspect_topic','inspect_proposals','propose_changes'} <= schemas_seen
        proposals=Collaboration(library).list(task_id=started['task_id'])['items']
        assert len(proposals)==1 and proposals[0]['dependencies'][0]['folder_id']==root
        assert results[-1]['dependencies'][0]['member_count']==4
        make_document(library,'新增.txt',root)
        assert Collaboration(library).get(proposals[0]['id'])['stale'] is True
    finally:service.close()


def test_partial_unsupported_and_failed_body_states(library):
    folder=make_folder(library,'解析状态')
    partial=make_document(library,'部分解析.pdf',folder,extraction='partial',parse='partial')
    add_block(library,partial,'partial fixture evidence')
    unsupported=make_document(library,'无文本扫描.pdf',folder,extraction='unsupported',parse='unsupported')
    failed=make_document(library,'损坏.pdf',folder,extraction='failed',parse='failed')
    tools=ResearchTools(library,{'mode':'workspace'})
    items={item['id']:item for item in tools.execute('browse_library',{'folder_id':folder})['items']}
    assert items[partial]['body_readable'] is True
    assert items[unsupported]['body_readable'] is False and items[failed]['body_readable'] is False
    assert tools.execute('inspect_document',{'id':partial})['parse']['body_state']=='readable'
    assert tools.execute('inspect_document',{'id':unsupported})['parse']['body_state']=='empty'
    assert tools.execute('inspect_document',{'id':failed})['parse']['body_state']=='unparsed'


def test_result_type_is_emitted_from_the_registry(library):
    from yorw_api.tool_registry import ToolRegistry, ToolSpec
    registry=ToolRegistry()
    registry.register(ToolSpec('demo','',{},'demo_result',lambda value:value,lambda value:{'ok':True}))
    assert registry.execute('demo',{})=={'ok':True,'result_type':'demo_result'}
    tools=ResearchTools(library,{'mode':'workspace'})
    assert tools.execute('inspect_scope',{})['result_type']=='scope'
    assert tools.execute('browse_library',{})['result_type']=='library'
    assert tools.execute('search_library',{'query':'none'})['result_type']=='library_search'


def test_tool_schemas_state_the_limits_the_validators_enforce(library):
    tools=ResearchTools(library,{'mode':'workspace'})
    schemas={item['function']['name']:item['function']['parameters'] for item in tools.schemas()}
    assert schemas['search_local']['properties']['query']['maxLength']==500
    assert schemas['search_library']['properties']['query']['maxLength']==200
    assert schemas['find_relations']['properties']['query']['maxLength']==200
    uuid_pattern=schemas['inspect_document']['properties']['id']['pattern']
    assert uuid_pattern and schemas['inspect_topic']['properties']['id']['pattern']==uuid_pattern
    assert schemas['browse_library']['properties']['folder_id']['pattern']==uuid_pattern
    with pytest.raises(ToolFault):tools.validate('browse_library',{'page_size':51})


def test_browse_and_search_report_remaining_pages_and_reading_position(library):
    folder=make_folder(library,'分页')
    documents={make_document(library,f'文件{index:02d}.txt',folder) for index in range(52)}
    tools=ResearchTools(library,{'mode':'workspace'})
    first=tools.execute('browse_library',{'folder_id':folder})
    second=tools.execute('browse_library',{'folder_id':folder,'page':2})
    assert first['has_more'] is True and second['has_more'] is False
    assert all(item['last_page']==1 for item in first['items']+second['items'])
    found=tools.execute('search_library',{'query':'文件'})
    assert len(found['items'])==50 and found['has_more'] is True and found['next_page']==2
    rest=tools.execute('search_library',{'query':'文件','page':2})
    assert len(rest['items'])==2 and rest['has_more'] is False
    assert {item['id'] for item in found['items']+rest['items']}==documents


def test_topic_scope_rejects_other_branch_and_hides_parent_identity(library):
    grandparent=make_topic(library,'祖母专题')
    parent=make_topic(library,'父专题')
    child=make_topic(library,'子专题')
    sibling=make_topic(library,'兄弟专题')
    with library.db.write() as conn:
        conn.execute('UPDATE topics SET parent_id=? WHERE id=?',(grandparent,parent))
        conn.execute('UPDATE topics SET parent_id=? WHERE id=?',(parent,child))
    tools=ResearchTools(library,{'mode':'topic','topic_id':child})
    scoped=tools.execute('inspect_topic',{'id':child})
    assert scoped['path_restricted'] is True and scoped['parent_id'] is None
    with pytest.raises(ToolFault,match='OBJECT_NOT_FOUND'):
        tools.execute('inspect_topic',{'id':parent})
    with pytest.raises(ToolFault,match='OBJECT_NOT_FOUND'):
        tools.execute('inspect_topic',{'id':sibling})


def test_topic_scope_filters_hidden_relations_notes_and_keeps_reading_notes(library):
    visible=make_topic(library,'可见专题')
    hidden=make_topic(library,'隐藏专题')
    document=make_document(library,'可见文献.txt')
    hidden_document=make_document(library,'隐藏文献.txt')
    link(library,document,visible);link(library,document,hidden);link(library,hidden_document,hidden)
    note={'id':str(uuid4())}
    with library.db.write() as conn:
        conn.execute('INSERT INTO notes(id,document_id,body_md,created_at,updated_at) VALUES(?,?,?,?,?)',(note['id'],document,'可见阅读笔记','time','time'))
        conn.execute("INSERT INTO document_relations(low_id,high_id,description,created_at,updated_at) VALUES(?,?,?,'time','time')",(min(document,hidden_document),max(document,hidden_document),'隐藏关联'))
    hidden_note=create_note(Notebooks(library),hidden,'隐藏专题笔记')
    tools=ResearchTools(library,{'mode':'topic','topic_id':visible})
    detail=tools.execute('inspect_document',{'id':document})
    assert [item['id'] for item in detail['relations']['topics']]==[visible]
    assert detail['relations']['documents']==[]
    assert [item['id'] for item in detail['notes']]==[note['id']]
    topic=tools.execute('inspect_topic',{'id':visible})
    assert hidden_note['id'] not in {item['id'] for item in topic['notes']}
    assert [item['id'] for item in topic['reading_notes']]==[note['id']]
    assert topic['relations']==[]
    assert [item['id'] for item in topic['materials']]==[document]


def test_proposal_status_tracks_accept_undo_and_dependencies(library):
    folder=make_folder(library,'依赖目录')
    make_document(library,'材料.txt',folder)
    tid,sid=research_origin(library)
    service=Collaboration(library)
    item=service.preview(Preview(request_id=uuid4(),task_id=tid,
        operations=[Operation(key='new',action='create_topic',title='实时方案',reason='用户明确要求')],
        dependencies=[FolderDependency(folder_id=UUID(folder))]))
    tools=ResearchTools(library,{'mode':'workspace'},session_id=sid,task_id=tid)
    listed=tools.execute('inspect_proposals',{})['items'][0]
    assert listed['dependencies'][0]['folder_id']==folder and listed['dependencies'][0]['member_count']==1
    accepted=service.decide(item['id'],Decision(request_id=uuid4(),version=item['version'],selected=['new']),'accept')
    assert tools.execute('inspect_proposals',{'proposal_id':item['id']})['proposal']['status']=='accepted'
    service.decide(item['id'],Decision(request_id=uuid4(),version=accepted['version'],selected=[]),'undo')
    assert tools.execute('inspect_proposals',{'proposal_id':item['id']})['proposal']['status']=='undone'


def test_all_member_dependency_invalidates_when_only_path_changes(library):
    first=make_folder(library,'甲')
    second=make_folder(library,'乙')
    folder=make_folder(library,'材料',first)
    make_document(library,'一.txt',folder)
    tid,_=research_origin(library)
    service=Collaboration(library)
    item=service.preview(Preview(request_id=uuid4(),task_id=tid,
        operations=[Operation(key='new',action='create_topic',title='移动依赖',reason='依据目录路径')],
        dependencies=[FolderDependency(folder_id=UUID(folder))]))
    record=next(row for row in Folders(library).list()['items'] if row['id']==folder)
    Folders(library).save(Change(name='材料',parent_id=UUID(second),version=record['version']),folder)
    current=service.get(item['id'])
    assert current['stale'] is True and current['dependencies'][0]['path']=='甲/材料'




