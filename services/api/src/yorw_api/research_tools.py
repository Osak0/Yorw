"""Read-only local tools with scope, version and issued-handle checks."""
import hashlib
import json
import re
from uuid import UUID
from fastapi import HTTPException
from .providers import ProbeError


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()


class ResearchTools:
    def __init__(self, library, scope):
        self.library, self.scope = library, scope
        self.issued, self.sources = {}, []
        self.initial = self.snapshot()

    def rows(self, sql, args=()):
        return self.library.rows(sql,args)

    def snapshot(self):
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

    def validate(self, name, value):
        if not isinstance(value,dict):raise ValueError()
        if name=='inspect_scope':
            if value:raise ValueError()
        elif name=='search_local':
            if set(value)!={'query'} or not isinstance(value['query'],str) or not 0<len(value['query'].strip())<=500:raise ValueError()
        elif name=='read_local':
            if set(value)!={'handle'} or not isinstance(value['handle'],str) or value['handle'] not in self.issued:raise ValueError()
        else:raise ValueError()
        return value

    def execute(self,name,value):
        self.check()
        if name=='inspect_scope':
            docs={d['id'] for d in self.initial['documents']}
            relations=[r for r in self.rows('SELECT low_id,high_id,description FROM document_relations') if r['low_id'] in docs and r['high_id'] in docs]
            return {'topics':self.initial['topics'][:40],'documents':self.initial['documents'][:40],'relations':relations[:40],'note_count':len(self.initial['notes']),'truncated':len(docs)>40 or len(self.initial['topics'])>40}
        if name=='read_local':
            expected=self.issued[value['handle']]
            current=self.resolve(expected['kind'],expected['object_id'])
            if current['version']!=expected['version']:raise ProbeError('SOURCE_UNAVAILABLE')
            start=expected['start'];text=current['text'][start:start+1800]
            if digest(text)!=expected['hash']:raise ProbeError('SOURCE_UNAVAILABLE')
            source={**{k:v for k,v in current.items() if k!='text'},'text':text,'start':start,'hash':digest(text)}
            existing=next((s for s in self.sources if s['kind']==source['kind'] and s['object_id']==source['object_id'] and s['start']==start),None)
            if existing:return existing
            source['citation']=f'S{len(self.sources)+1}'
            if len(self.sources)>=16:raise ProbeError('TOOL_LIMIT_EXCEEDED')
            self.sources.append(source)
            return source
        query=value['query'].strip()
        terms=list(dict.fromkeys(re.findall(r'[a-zA-Z0-9_]+|[\u4e00-\u9fff]{1,8}',query.lower())))[:12]
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
            result.append({'handle':handle,'kind':source['kind'],'title':source['title'],'snippet':text[:350]})
        return {'items':result,'mode':'keyword'}

    def available(self,source):
        try:
            current=self.resolve(source['kind'],source['object_id'])
            return current['version']==source['version'] and digest(current['text'][source['start']:source['start']+1800])==source['hash']
        except (ProbeError,KeyError):return False


TOOL_SCHEMAS=[]
for name,description,field in [('search_local','Find relevant original document blocks, reading notes and topic text. Search again with other terms when needed.','query'),('read_local','Read a handle returned by search_local before citing it.','handle'),('inspect_scope','Inspect permitted local topics, documents and document relations.',None)]:
    TOOL_SCHEMAS.append({'type':'function','function':{'name':name,'description':description,'parameters':{'type':'object','properties':{field:{'type':'string'}} if field else {},'required':[field] if field else [],'additionalProperties':False}}})
