"""Read-only local tools with scope, version and issued-handle checks.

Every tool is declared once in TOOL_DEFINITIONS and registered with the shared
ToolRegistry, which supplies both the model schema and the validator/executor.
"""
import hashlib
import json
import re
from uuid import UUID
from fastapi import HTTPException
from .providers import ProbeError
from .research_catalog import CatalogReader, MAX_PAGE_SIZE, PAGE_SIZE, UUID_PATTERN
from .tool_errors import ToolFault
from .tool_registry import ToolRegistry, ToolSpec


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()


def identity(value):
    try:return str(UUID(str(value)))
    except (ValueError,TypeError,AttributeError):raise ValueError() from None


ID_SCHEMA={'type':'string','pattern':UUID_PATTERN}


TOOL_DEFINITIONS=[
    ('search_local','Find relevant original document blocks, reading notes and topic text. Search again with other terms when needed.',
     {'type':'object','properties':{'query':{'type':'string','maxLength':500}},'required':['query'],'additionalProperties':False},'sources'),
    ('read_local','Read a handle returned by search_local before citing it.',
     {'type':'object','properties':{'handle':{'type':'string','maxLength':32,'pattern':'^[0-9a-f]{32}$'}},'required':['handle'],'additionalProperties':False},'source'),
    ('inspect_scope','Inspect permitted local topics, documents and document relations.',
     {'type':'object','properties':{},'required':[],'additionalProperties':False},'scope'),
    ('find_relations','Find related existing scoped documents and topics, with reasons and versions. Empty results are valid. Does not change relations or scope.',
     {'type':'object','properties':{'kind':{'type':'string','enum':['document','topic']},'id':ID_SCHEMA,'query':{'type':'string','maxLength':200}},'required':['kind','id','query'],'additionalProperties':False},'relations'),
    ('browse_library','Browse Storage logical directories. Omit folder_id for the root. Returns subdirectories and documents with stable IDs, full logical paths, versions, parse status and navigation. Use recursive only when the whole subtree is needed; results are paged (default 50). Directory organization is user intent, not paper evidence.',
     {'type':'object','properties':{'folder_id':ID_SCHEMA,'page':{'type':'integer','minimum':1},'page_size':{'type':'integer','minimum':1,'maximum':MAX_PAGE_SIZE},'recursive':{'type':'boolean'}},'required':[],'additionalProperties':False},'library'),
    ('search_library','Search Storage directory names, full logical paths, document titles and original filenames. Results state the match type; same-name objects are disambiguated by full path. This does not search body text; use search_local for evidence.',
     {'type':'object','properties':{'query':{'type':'string','maxLength':200},'kind':{'type':'string','enum':['all','folder','document']},'page':{'type':'integer','minimum':1},'page_size':{'type':'integer','minimum':1,'maximum':MAX_PAGE_SIZE}},'required':['query'],'additionalProperties':False},'library_search'),
    ('read_document','Browse one visible document\'s extracted text in reading order, returning page numbers and snippets. Each snippet has a handle; call read_local with that handle to read the exact text and obtain a citable [S] source. Use this to review a document before writing notes about it.',
     {'type':'object','properties':{'id':ID_SCHEMA,'start':{'type':'integer','minimum':0}},'required':['id'],'additionalProperties':False},'document_text'),
    ('inspect_document','Read one scoped document folder, metadata, parse status, notes and relations. Does not return body text; use search_local and read_local for original evidence.',
     {'type':'object','properties':{'id':ID_SCHEMA},'required':['id'],'additionalProperties':False},'document'),
    ('inspect_topic','Read one scoped topic parent/children, notes, materials, ordinary relations and effective note scope. Topics and directories are different objects.',
     {'type':'object','properties':{'id':ID_SCHEMA},'required':['id'],'additionalProperties':False},'topic'),
    ('inspect_workspace','Read the current visible Storage folder list and Garden topic list with paths and counts. This outline starts every request; call it again after the user asks about structure so you answer from the database rather than memory.',
     {'type':'object','properties':{},'required':[],'additionalProperties':False},'workspace_outline'),
    ('browse_garden','Browse the visible Garden topic hierarchy or search topic paths by query. Returns stable IDs, parent relationships, paths and child counts. Use inspect_topic for notes, materials and ordinary relations.',
     {'type':'object','properties':{'parent_id':ID_SCHEMA,'query':{'type':'string','maxLength':200},'page':{'type':'integer','minimum':1},'page_size':{'type':'integer','minimum':1,'maximum':50}},'required':[],'additionalProperties':False},'garden'),
    ('inspect_proposals','List formal-change proposals created in the current research session, or read one proposal live status. A proposal is not a formal material until the user adopts it.',
     {'type':'object','properties':{'proposal_id':ID_SCHEMA},'required':[],'additionalProperties':False},'proposal_status'),
]


class ResearchTools:
    def __init__(self,library,scope,*,session_id=None,task_id=None):
        self.library, self.scope = library, scope
        self.session_id, self.task_id = session_id, task_id
        self.issued, self.sources = {}, []
        self.initial = self.snapshot()
        self.catalog = CatalogReader(library, self.initial, scope, session_id=session_id, task_id=task_id)
        self.registry = self._registry()

    def _registry(self):
        registry=ToolRegistry()
        for name,description,parameters,result_kind in TOOL_DEFINITIONS:
            registry.register(ToolSpec(name,description,parameters,result_kind,
                validate=lambda value,n=name:self._validate(n,value),
                execute=lambda value,n=name:self._execute(n,value)))
        return registry

    def bind(self,session_id,task_id):
        self.session_id,self.task_id=session_id,task_id
        self.catalog.session_id,self.catalog.task_id=session_id,task_id

    def rows(self, sql, args=()):
        return self.library.rows(sql,args)

    def snapshot(self):
        # Scope helpers use the shared SQLite connection directly. Hold the same
        # reentrant lock as writes for the entire snapshot, including cursor reads.
        with self.library.db.lock:return self._snapshot()

    def _snapshot(self):
        from .notebooks import visible_topics,selected_topics,notebook_heads
        topics=self.rows('SELECT id,parent_id,title,current_revision_id,version FROM topics WHERE deleted_at IS NULL AND notebook_only=0 ORDER BY id')
        allowed={t['id'] for t in topics}
        if self.scope['mode']=='topic':
            try:allowed=set(selected_topics(self.library.db,self.scope.get('topic_id')))
            except HTTPException:raise ProbeError('SCOPE_CHANGED') from None
        heads=notebook_heads(self.library.db,allowed)
        notebooks=[r for r in self.rows('SELECT id,title,current_revision_id,version FROM topics WHERE deleted_at IS NULL ORDER BY id') if r['id'] in heads]
        docs=self.rows('SELECT id,title,original_name,extraction_version,version FROM documents WHERE deleted_at IS NULL ORDER BY id')
        if self.scope['mode']=='topic':
            linked={r['document_id'] for r in self.rows('SELECT document_id,topic_id FROM document_topics') if r['topic_id'] in allowed}
            docs=[d for d in docs if d['id'] in linked]
        ids={d['id'] for d in docs}
        notes=[n for n in self.rows('SELECT id,document_id,version FROM notes ORDER BY id') if n['document_id'] in ids]
        return {'topics':[t for t in topics if t['id'] in allowed],'documents':docs,'notes':notes,'notebooks':notebooks}

    def check(self):
        if self.snapshot()!=self.initial:raise ProbeError('CONTEXT_CHANGED')

    def resolve(self,kind,identity):
        snapshot=self.initial
        if kind=='document':
            rows=self.rows('SELECT b.*,d.title,d.original_name FROM document_blocks b JOIN documents d ON d.id=b.document_id AND d.extraction_version=b.extraction_version WHERE b.id=? AND d.deleted_at IS NULL',(identity,))
            if not rows or rows[0]['document_id'] not in {d['id'] for d in snapshot['documents']}:raise ProbeError('SOURCE_UNAVAILABLE')
            row=rows[0]
            return {'kind':kind,'object_id':identity,'document_id':row['document_id'],'title':row['title'] or row['original_name'],'version':str(row['extraction_version']),'text':row['text'],'page':row['physical_page'],'block_id':identity}
        if kind=='note':
            rows=self.rows('SELECT * FROM notes WHERE id=?',(identity,))
            if not rows or identity not in {n['id'] for n in snapshot['notes']}:raise ProbeError('SOURCE_UNAVAILABLE')
            row=rows[0]
            return {'kind':kind,'object_id':identity,'document_id':row['document_id'],'title':'阅读笔记','version':str(row['version']),'text':row['body_md']}
        if kind=='topic':
            rows=self.rows('SELECT t.id,t.title,t.current_revision_id,r.body_md FROM topics t JOIN revisions r ON r.id=t.current_revision_id WHERE t.id=? AND t.deleted_at IS NULL',(identity,))
            if not rows or identity not in {t['id'] for t in snapshot['notebooks']}:raise ProbeError('SOURCE_UNAVAILABLE')
            row=rows[0]
            return {'kind':kind,'object_id':identity,'title':row['title'],'version':row['current_revision_id'],'text':row['body_md']}
        raise ProbeError('INVALID_TOOL_ARGUMENTS')

    def read_document(self, identity, start=0, max_blocks=6):
        """Walk one document's current extraction in reading order.

        Snippets stay short; each carries a handle so read_local can return the
        exact text and allocate a citation. No source number is spent here.
        """
        documents={row['id']:row for row in self.initial['documents']}
        if identity not in documents:
            raise ToolFault('OBJECT_NOT_FOUND', field='id', expected='a visible document ID')
        with self.library.db.lock:
            rows=self.rows('SELECT title,original_name,extraction_version FROM documents WHERE id=? AND deleted_at IS NULL',(identity,))
            if not rows:
                raise ToolFault('OBJECT_NOT_FOUND', field='id', expected='a visible document ID')
            document=rows[0]
            blocks=self.rows('SELECT id,ordinal,physical_page,text FROM document_blocks WHERE document_id=? AND extraction_version=? ORDER BY ordinal',
                             (identity,document['extraction_version']))
        title=document['title'] or document['original_name'];version=str(document['extraction_version'])
        items=[]
        for block in blocks[start:start+max_blocks]:
            excerpt=(block['text'] or '')[:1800]
            handle=digest(('document',block['id'],version,0))[:32]
            self.issued[handle]={'kind':'document','object_id':block['id'],'version':version,'start':0,'hash':digest(excerpt)}
            items.append({'handle':handle,'block_id':block['id'],'page':block['physical_page'],
                          'ordinal':block['ordinal'],'snippet':excerpt[:600],
                          'navigation':self.navigation_for('document',identity,title)})
        next_start=start+len(items)
        return {'kind':'document_text','id':identity,'title':title,'version':version,
                'state':'empty' if not blocks else 'ok','items':items,
                'total_blocks':len(blocks),
                'next':next_start if next_start<len(blocks) else None,
                'truncated':next_start<len(blocks)}

    def _validate(self, name, value):
        def fail(field, expected):
            raise ToolFault('INVALID_ARGUMENT', field=field, expected=expected)
        def pages():
            if 'page' in value and (type(value['page']) is not int or value['page'] < 1):
                fail('page', 'integer >= 1')
            if 'page_size' in value and (type(value['page_size']) is not int or not 1 <= value['page_size'] <= MAX_PAGE_SIZE):
                fail('page_size', f'integer 1-{MAX_PAGE_SIZE}')
        if not isinstance(value, dict):
            fail('arguments', 'a JSON object')
        if name in ('inspect_scope','inspect_workspace'):
            if value: fail('arguments', 'no arguments')
        elif name == 'search_local':
            if set(value) != {'query'}: fail('arguments', 'only query')
            if not isinstance(value['query'], str) or not 0 < len(value['query'].strip()) <= 500:
                fail('query', 'a non-empty query of at most 500 characters')
        elif name == 'read_local':
            if set(value) != {'handle'}: fail('arguments', 'only handle')
            if not isinstance(value['handle'], str) or value['handle'] not in self.issued:
                fail('handle', 'a handle returned by search_local in this task')
        elif name == 'find_relations':
            if set(value) != {'kind', 'id', 'query'}: fail('arguments', 'kind, id and query')
            if value['kind'] not in ('topic', 'document'): fail('kind', 'document or topic')
            if not isinstance(value['query'], str) or len(value['query']) > 200:
                fail('query', 'at most 200 characters')
            try: value['id'] = identity(value['id'])
            except ValueError: fail('id', 'UUID')
            if value['id'] not in {r['id'] for r in self.initial['topics' if value['kind'] == 'topic' else 'documents']}:
                raise ToolFault('OBJECT_NOT_FOUND', field='id', expected='an in-scope document or topic ID')
        elif name == 'browse_garden':
            if set(value)-{'parent_id','query','page','page_size'}: fail('arguments','parent_id, query, page or page_size')
            if value.get('parent_id') is not None:
                try: value['parent_id']=identity(value['parent_id'])
                except ValueError: fail('parent_id','UUID')
            if not isinstance(value.get('query',''),str) or len(value.get('query',''))>200: fail('query','at most 200 characters')
            pages()
        elif name == 'browse_library':
            if set(value) - {'folder_id', 'page', 'page_size', 'recursive'}:
                fail('arguments', 'folder_id, page, page_size or recursive')
            if value.get('folder_id') is not None:
                try: value['folder_id'] = identity(value['folder_id'])
                except ValueError: fail('folder_id', 'UUID or omitted for the root')
            if 'recursive' in value and type(value['recursive']) is not bool:
                fail('recursive', 'true or false')
            pages()
        elif name == 'search_library':
            if set(value) - {'query', 'kind', 'page', 'page_size'}:
                fail('arguments', 'query, kind, page or page_size')
            if not isinstance(value.get('query'), str) or not 0 < len(value['query'].strip()) <= 200:
                fail('query', 'a non-empty query of at most 200 characters')
            if value.get('kind', 'all') not in ('all', 'folder', 'document'):
                fail('kind', 'all, folder or document')
            pages()
        elif name == 'read_document':
            if set(value) - {'id', 'start'}: fail('arguments', 'id and optional start')
            try: value['id'] = identity(value['id'])
            except ValueError: fail('id', 'UUID')
            if 'start' in value and (type(value['start']) is not int or value['start'] < 0):
                fail('start', 'integer >= 0')
        elif name in ('inspect_document', 'inspect_topic'):
            if set(value) != {'id'}: fail('arguments', 'only id')
            try: value['id'] = identity(value['id'])
            except ValueError: fail('id', 'UUID')
        elif name == 'inspect_proposals':
            if set(value) - {'proposal_id'}: fail('arguments', 'only proposal_id')
            if value.get('proposal_id') is not None:
                try: value['proposal_id'] = identity(value['proposal_id'])
                except ValueError: fail('proposal_id', 'UUID')
        else:
            fail('arguments', 'a declared tool')
        return value

    def _execute(self,name,value):
        # Proposal status is session state, not a material snapshot: adoption may
        # legitimately change the scope after this task started.
        if name!='inspect_proposals':self.check()
        if name=='inspect_workspace':return self.catalog.outline()
        if name=='browse_garden':return self.catalog.garden(**value)
        if name=='browse_library':            return self.catalog.browse(value.get('folder_id'),value.get('page',1),value.get('page_size',PAGE_SIZE),value.get('recursive',False))
        if name=='search_library':
            return self.catalog.search(value['query'].strip(),value.get('kind','all'),value.get('page',1),value.get('page_size',PAGE_SIZE))
        if name=='read_document':
            return self.read_document(value['id'],value.get('start',0))
        if name=='inspect_document':
            return self.catalog.inspect_document(value['id'])
        if name=='inspect_topic':
            return self.catalog.inspect_topic(value['id'])
        if name=='inspect_proposals':
            return self.catalog.inspect_proposals(value.get('proposal_id'))
        if name=='find_relations':
            from .relations import Relations
            allowed={kind:{r['id'] for r in self.initial[key]} for kind,key in [('topic','topics'),('document','documents')]}
            try:found=Relations(self.library).candidates(value['kind'],value['id'],value['query'],allowed)
            except HTTPException as error:raise ProbeError(str(error.detail)) from None
            for item in found['items']:item['navigation']=self.navigation_for(item['kind'],item['id'],item['title'])
            return found
        if name=='inspect_scope':
            docs={d['id'] for d in self.initial['documents']}
            relations=[r for r in self.rows('SELECT low_id,high_id,description FROM document_relations') if r['low_id'] in docs and r['high_id'] in docs]
            topics={t['id'] for t in self.initial['topics']}
            topic_relations=[r for r in self.rows('SELECT low_id,high_id,description FROM topic_relations') if r['low_id'] in topics and r['high_id'] in topics]
            documents=[{**row,'kind':'document','navigation':self.navigation_for('document',row['id'],row['title'] or row['original_name'])} for row in self.initial['documents']]
            topic_items=[{**row,'kind':'topic','navigation':self.navigation_for('topic',row['id'],row['title'])} for row in self.initial['topics']]
            note_items=[{**row,'kind':'note','navigation':self.navigation_for('note',row['id'],'阅读笔记',row['document_id'])} for row in self.initial['notes']]
            notebook_items=[{**row,'kind':'topic_note','navigation':self.navigation_for('topic_note',row['id'],row['title'])} for row in self.initial['notebooks']]
            return {'topics':topic_items[:40],'documents':documents[:40],'relations':relations[:40],'topic_relations':topic_relations[:40],'notes':note_items[:40],'notebooks':notebook_items[:40],'note_count':len(note_items),'truncated':any(len(items)>40 for items in (documents,topic_items,note_items,notebook_items))}
        if name=='read_local':
            expected=self.issued[value['handle']]
            current=self.resolve(expected['kind'],expected['object_id'])
            if current['version']!=expected['version']:raise ProbeError('SOURCE_UNAVAILABLE')
            start=expected['start'];text=current['text'][start:start+1800]
            if digest(text)!=expected['hash']:raise ProbeError('SOURCE_UNAVAILABLE')
            source={**{k:v for k,v in current.items() if k!='text'},'text':text,'start':start,'hash':digest(text)}
            source['navigation']=self.navigation_for(source['kind'],source['object_id'],source['title'],source.get('document_id'))
            existing=next((s for s in self.sources if s['kind']==source['kind'] and s['object_id']==source['object_id'] and s['start']==start),None)
            if existing:return existing
            source['citation']=f'S{len(self.sources)+1}'
            if len(self.sources)>=24:raise ProbeError('TOOL_LIMIT_EXCEEDED')
            self.sources.append(source)
            return source
        query=value['query'].strip()
        terms=list(dict.fromkeys(re.findall(r'[a-zA-Z0-9_]+|[一-鿿]{1,8}',query.lower())))[:12]
        if not terms:return {'items':[]}
        # SQL filters and result caps prevent loading every full document into memory.
        clauses=' OR '.join("lower({}) LIKE ? ESCAPE '\\'".format('TEXT_COLUMN') for _ in terms)
        args=tuple('%'+t.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%' for t in terms)
        candidates=[]
        for kind,sql,column in [
            ('document','SELECT b.id,b.document_id,substr(b.text,1,200) AS excerpt FROM document_blocks b JOIN documents d ON d.id=b.document_id AND d.extraction_version=b.extraction_version WHERE d.deleted_at IS NULL AND ({}) AND SCOPE_FILTER ORDER BY b.document_id,b.ordinal LIMIT 200','b.text'),
            ('note','SELECT id,document_id,substr(body_md,1,200) AS excerpt FROM notes WHERE ({}) AND SCOPE_FILTER ORDER BY updated_at DESC LIMIT 100','body_md'),
            ('topic','SELECT t.id,substr(r.body_md,1,200) AS excerpt FROM topics t JOIN revisions r ON r.id=t.current_revision_id WHERE t.deleted_at IS NULL AND ({}) AND SCOPE_FILTER ORDER BY t.id LIMIT 100','r.body_md')]:
            allowed=([d['id'] for d in self.initial['documents']] if kind!='topic' else [t['id'] for t in self.initial['notebooks']])
            if not allowed:continue
            identity_column='b.document_id' if kind=='document' else 'document_id' if kind=='note' else 't.id'
            scoped=identity_column+' IN ('+','.join('?' for _ in allowed)+')'
            for row in self.rows(sql.format(clauses.replace('TEXT_COLUMN',column)).replace('SCOPE_FILTER',scoped),args+tuple(allowed)):
                try:source=self.resolve(kind,row['id'])
                except ProbeError:continue
                lowered=source['text'].lower();positions=[lowered.find(t) for t in terms if t in lowered]
                if not positions:continue
                start=max(0,min(positions)-150);text=source['text'][start:start+1800]
                handle=digest((kind,row['id'],source['version'],start))[:32]
                record={'kind':kind,'object_id':row['id'],'version':source['version'],'start':start,'hash':digest(text)}
                candidates.append((len(positions),handle,source,record,text))
        candidates.sort(key=lambda x:(-x[0],x[1]))
        result=[]
        for _,handle,source,record,text in candidates[:8]:
            self.issued[handle]=record
            identity=source['document_id'] if source['kind'] in ('document','note') else source['object_id']
            result.append({'handle':handle,'kind':source['kind'],'id':identity,
                           'title':source['title'],'version':source['version'],
                           'document_id':source.get('document_id'),'snippet':text[:350],
                           'navigation':self.navigation_for(source['kind'],source['object_id'],source['title'],source.get('document_id'))})
        return {'items':result,'mode':'keyword'}

    def navigation_for(self,kind,identity,title,document_id=None):
        from .research_catalog import navigation
        if kind=='document':return navigation('document',document_id or identity,title)
        if kind=='note':return navigation('reading_note',identity,title,document_id=document_id)
        if kind in ('topic','topic_note'):return navigation(kind,identity,title)
        raise ProbeError('INVALID_TOOL_ARGUMENTS')

    def available(self,source):
        try:
            current=self.resolve(source['kind'],source['object_id'])
            return current['version']==source['version'] and digest(current['text'][source['start']:source['start']+1800])==source['hash']
        except (ProbeError,KeyError):return False

    def validate(self,name,value):
        return self.registry.validate(name,value)

    def execute(self,name,value):
        return self.registry.execute(name,value)

    def schemas(self):
        return self.registry.schemas()

    @property
    def validators(self):
        return {name:spec.validate for name,spec in self.registry.specs.items()}
