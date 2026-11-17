"""Origin-based notebook visibility; immutable revisions and AI decisions keep their IDs."""
import json
from uuid import UUID,uuid4
from fastapi import APIRouter,HTTPException
from pydantic import BaseModel,ConfigDict,Field
from .library import now
from .garden import Garden
from .relations import Relations

class Create(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    id:UUID
    title:str=Field(min_length=1,max_length=120)
class Rename(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    title:str=Field(min_length=1,max_length=120)
    version:int=Field(ge=1)
class Scope(BaseModel):
    model_config=ConfigDict(extra='forbid')
    version:int=Field(ge=1)
    rules:dict[UUID,bool]=Field(max_length=5000)
class Remove(BaseModel):
    model_config=ConfigDict(extra='forbid')
    version:int=Field(ge=1)

def visible_topics(database):
    cursor=database.connection.execute('SELECT id,parent_id,title,version FROM topics WHERE deleted_at IS NULL AND notebook_only=0 ORDER BY created_at,id')
    return [dict(zip([c[0] for c in cursor.description],r)) for r in cursor.fetchall()]

def origin(database,identity):
    row=database.connection.execute('SELECT topic_id FROM topic_notebooks WHERE id=? AND deleted_at IS NULL',(identity,)).fetchone()
    return row[0] if row else identity

def selected_topics(database,identity,*,parents=None):
    """Nearest explicit ancestor wins; gathering never propagates gathered notes."""
    rows=visible_topics(database);tree={t['id']:t for t in rows}
    if identity not in tree:raise HTTPException(404,detail='TOPIC_NOT_FOUND')
    if parents:
        for key,parent in parents.items():
            if key in tree:tree[key]={**tree[key],'parent_id':parent}
    rules=dict(database.connection.execute('SELECT source_topic_id,selected FROM topic_note_scope WHERE topic_id=?',(identity,)))
    if not rules:rules={identity:True}
    result=[]
    for target in tree:
        current=target;seen=set()
        while current and current not in seen:
            seen.add(current)
            if current in rules:
                if rules[current]:result.append(target)
                break
            current=tree.get(current,{}).get('parent_id')
    return sorted(result)

def invalidate(database):
    database.connection.execute("UPDATE research_tasks SET status='context_changed',error_code='CONTEXT_CHANGED',updated_at=? WHERE status='running'",(now(),))

def notebook_heads(database,allowed):
    if not allowed:return []
    return [r[0] for r in database.connection.execute('SELECT n.id FROM topic_notebooks n JOIN topics owner ON owner.id=n.topic_id JOIN topics head ON head.id=n.id WHERE n.deleted_at IS NULL AND owner.deleted_at IS NULL AND owner.notebook_only=0 AND head.deleted_at IS NULL AND n.topic_id IN ('+','.join('?' for _ in allowed)+') ORDER BY n.id',tuple(allowed))]

class Notebooks:
    def __init__(self,library):self.library=library;self.db=library.db
    def rows(self,sql,args=()):return self.library.rows(sql,args)
    def topic(self,identity):
        value=Garden(self.db)._topic(identity)
        if value.get('notebook_only'):raise HTTPException(404,detail='TOPIC_NOT_FOUND')
        return value
    def catalog(self):
        with self.db.lock:
            ids=notebook_heads(self.db,[t['id'] for t in visible_topics(self.db)])
            ids += [r['head_id'] for r in self.rows('SELECT h.head_id FROM reading_note_heads h JOIN notes n ON n.id=h.note_id JOIN documents d ON d.id=n.document_id WHERE d.deleted_at IS NULL')]
            return {'items':[self.summary(i) for i in ids]}
    def scope(self,identity):
        with self.db.lock:
            topic=self.topic(identity)
            rules={r['source_topic_id']:bool(r['selected']) for r in self.rows('SELECT * FROM topic_note_scope WHERE topic_id=?',(identity,))} or {identity:True}
            return {'topics':visible_topics(self.db),'rules':rules,'selected':selected_topics(self.db,identity),'version':topic['version']}
    def save_scope(self,identity,value):
        with self.db.write() as conn:
            if self.topic(identity)['version']!=value.version:raise HTTPException(409,detail='TOPIC_CONFLICT')
            for key in value.rules:self.topic(str(key))
            conn.execute('DELETE FROM topic_note_scope WHERE topic_id=?',(identity,))
            # An empty selection must remain empty rather than falling back to defaults.
            if not value.rules:conn.execute('INSERT INTO topic_note_scope VALUES(?,?,0)',(identity,identity))
            for key,chosen in value.rules.items():conn.execute('INSERT INTO topic_note_scope VALUES(?,?,?)',(identity,str(key),int(chosen)))
            conn.execute('UPDATE topics SET version=version+1,updated_at=? WHERE id=?',(now(),identity))
            invalidate(self.db)
        return self.scope(identity)
    def get(self,identity):
        with self.db.lock:
            rows=self.rows('SELECT * FROM topic_notebooks WHERE id=? AND deleted_at IS NULL',(identity,))
            if not rows:
                reading=self.rows('SELECT h.*,n.document_id,n.body_md,n.version,n.created_at,n.updated_at,d.title,d.original_name FROM reading_note_heads h JOIN notes n ON n.id=h.note_id JOIN documents d ON d.id=n.document_id WHERE h.head_id=? AND d.deleted_at IS NULL',(identity,))
                if not reading:raise HTTPException(404,detail='NOTE_NOT_FOUND')
                row=reading[0]
                return {'id':identity,'reading_note_id':row['note_id'],'kind':'document','document_id':row['document_id'],'owner_title':row['title'] or row['original_name'],'title':'文献笔记优化','body_md':row['body_md'],'version':row['version'],'created_at':row['created_at'],'updated_at':row['updated_at']}

            record=rows[0];owner=self.topic(record['topic_id']);view=Garden(self.db).get(identity)
            return {**record,'title':record['title'] or view['topic']['title'],'owner_title':owner['title'],'body_md':view['revision']['body_md'],'sources':view['revision']['sources'],'version':view['topic']['version'],'base_revision_id':view['revision']['id'],'created_at':view['topic']['created_at'],'updated_at':view['topic']['updated_at']}
    def summary(self,identity):
        value=self.get(identity)
        return {k:v for k,v in value.items() if k not in ('body_md','sources')}|{'kind':value.get('kind','topic'),'excerpt':value['body_md'][:240]}
    def create(self,topic,value):
        identity=str(value.id)
        with self.db.write() as conn:
            self.topic(topic)
            if self.rows('SELECT id FROM topics WHERE id=?',(identity,)):
                existing=self.get(identity)
                if existing['topic_id']==topic and existing['title']==value.title:return existing
                raise HTTPException(409,detail='NOTE_CONFLICT')
            stamp=now();rid=str(uuid4())
            conn.execute('INSERT INTO topics(id,title,notebook_only,created_at,updated_at) VALUES(?,?,1,?,?)',(identity,value.title,stamp,stamp))
            conn.execute("INSERT INTO revisions(id,topic_id,ordinal,body_md,origin,created_at) VALUES(?,?,1,'','manual',?)",(rid,identity,stamp))
            conn.execute('INSERT INTO topic_notebooks(id,topic_id,deleted_at,created_at,updated_at) VALUES(?,?,NULL,?,?)',(identity,topic,stamp,stamp))
            conn.execute('UPDATE topics SET current_revision_id=? WHERE id=?',(rid,identity))
        return self.get(identity)
    def rename(self,identity,value):
        with self.db.write() as conn:
            note=self.get(identity)
            if note.get('kind')=='document':raise HTTPException(422,detail='INVALID_INPUT')
            if note['version']!=value.version:raise HTTPException(409,detail='NOTE_CONFLICT')
            # Legacy heads share a title with the former Wiki; don't rename their owner.
            conn.execute('UPDATE topic_notebooks SET title=?,updated_at=? WHERE id=?',(value.title,now(),identity))
            conn.execute('UPDATE topics SET version=version+1,updated_at=? WHERE id=?',(now(),identity))
            if identity!=note['topic_id']:conn.execute('UPDATE topics SET title=? WHERE id=?',(value.title,identity))
        return self.get(identity)
    def remove(self,identity,value):
        with self.db.write() as conn:
            note=self.get(identity)
            if note.get('kind')=='document':raise HTTPException(422,detail='INVALID_INPUT')
            if note['version']!=value.version:raise HTTPException(409,detail='NOTE_CONFLICT')
            if identity==note['topic_id']:
                current=Garden(self.db).get(identity)['revision'];rid=str(uuid4());stamp=now()
                conn.execute("INSERT INTO revisions(id,topic_id,ordinal,body_md,sources_json,origin,base_revision_id,created_at) VALUES(?,?,?,'','[]','notebook_deleted',?,?)",(rid,identity,current['ordinal']+1,current['id'],stamp))
                conn.execute('UPDATE topics SET current_revision_id=?,version=version+1,updated_at=? WHERE id=?',(rid,stamp,identity))
            conn.execute('UPDATE topic_notebooks SET deleted_at=?,updated_at=? WHERE id=?',(now(),now(),identity))
            if identity!=note['topic_id']:conn.execute('UPDATE topics SET deleted_at=?,version=version+1,updated_at=? WHERE id=?',(now(),now(),identity))
            invalidate(self.db)
        return {'removed':True}
    def prepare_reading(self,identity,value):
        from .notes import Notes
        from .foreground import assert_idle
        with self.db.write() as conn:
            assert_idle(conn)
            note=Notes(self.db)._get(identity)
            if not note['document_available']:raise HTTPException(404,detail='DOCUMENT_NOT_FOUND')
            if note['version']!=value.version:raise HTTPException(409,detail='NOTE_CONFLICT')
            rows=self.rows('SELECT * FROM reading_note_heads WHERE note_id=?',(identity,))
            if rows:
                head=rows[0]['head_id']
                if self.rows("SELECT id FROM suggestions WHERE topic_id=? AND status='running'",(head,)):raise HTTPException(409,detail='SUGGESTION_RUNNING')
                if rows[0]['base_note_version']==note['version']:return Garden(self.db).get(head)
                current=Garden(self.db).get(head)['revision'];ordinal=current['ordinal']+1
            else:
                head=str(uuid4());stamp=now();ordinal=1
                conn.execute('INSERT INTO topics(id,title,notebook_only,created_at,updated_at) VALUES(?,?,1,?,?)',(head,'文献笔记优化',stamp,stamp))
                conn.execute('INSERT INTO reading_note_heads VALUES(?,?,?)',(head,identity,note['version']))
            rid=str(uuid4());stamp=now()
            conn.execute("INSERT INTO revisions(id,topic_id,ordinal,body_md,sources_json,origin,created_at) VALUES(?,?,?,?,?,'reading_note_snapshot',?)",(rid,head,ordinal,note['body_md'],json.dumps(note['sources']),stamp))
            conn.execute('UPDATE topics SET current_revision_id=?,version=version+1,updated_at=? WHERE id=?',(rid,stamp,head))
            conn.execute('UPDATE reading_note_heads SET base_note_version=? WHERE head_id=?',(note['version'],head))
        return Garden(self.db).get(head)

    def move_preview(self,identity,parent):
        with self.db.lock:
            self.topic(identity)
            if parent:self.topic(parent)
            Garden(self.db)._parent(identity,parent)
            affected=[]
            for topic in visible_topics(self.db):
                before=selected_topics(self.db,topic['id']);after=selected_topics(self.db,topic['id'],parents={identity:parent})
                if before!=after:affected.append({'id':topic['id'],'title':topic['title'],'before':before,'after':after})
            return {'affected':affected}
    def overview(self,identity):
        with self.db.lock:
            scope=self.scope(identity);allowed=scope['selected'];notes=[];documents=[]
            for head in notebook_heads(self.db,allowed):
                note=self.summary(head);notes.append({**note,'shared':note['topic_id']!=identity})
            from .notes import Notes
            linked=self.rows('SELECT d.id,d.title,d.original_name,d.authors_json,d.year,dt.topic_id FROM documents d JOIN document_topics dt ON dt.document_id=d.id WHERE d.deleted_at IS NULL ORDER BY d.id')
            owned_docs={d['id'] for d in linked if d['topic_id']==identity}
            for doc in linked:
                if doc['topic_id'] in allowed and doc['id'] not in {d['id'] for d in documents}:
                    documents.append(doc)
                    for note in Notes(self.db).list(doc['id']):notes.append({k:v for k,v in note.items() if k not in ('body_md','sources')}|{'kind':'document','title':(note['body_md'].splitlines() or ['阅读笔记'])[0].lstrip('# ')[:120] or '阅读笔记','excerpt':note['body_md'][:240],'owner_title':doc['title'] or doc['original_name'],'shared':doc['id'] not in owned_docs})
            notes.sort(key=lambda n:n['updated_at'],reverse=True)
            return {'topic':self.topic(identity),'owned_notes':[self.summary(row['id']) for row in self.rows('SELECT id FROM topic_notebooks WHERE topic_id=? AND deleted_at IS NULL',(identity,))],'notes':notes,'documents':documents,'topics':[t for t in scope['topics'] if t['parent_id']==identity],'scope':scope,'relations':Relations(self.library).topics(identity)['items']}

def router(library):
    service=Notebooks(library);routes=APIRouter()
    @routes.get('/v1/notebooks')
    def catalog():return service.catalog()
    @routes.get('/v1/topics/{identity}/overview')
    def overview(identity:UUID):return service.overview(str(identity))
    @routes.get('/v1/topics/{identity}/note-scope')
    def scope(identity:UUID):return service.scope(str(identity))
    @routes.put('/v1/topics/{identity}/note-scope')
    def save_scope(identity:UUID,value:Scope):return service.save_scope(str(identity),value)
    @routes.post('/v1/topics/{identity}/notebooks')
    def create(identity:UUID,value:Create):return service.create(str(identity),value)
    @routes.get('/v1/notebooks/{identity}')
    def get(identity:UUID):return service.get(str(identity))
    @routes.patch('/v1/notebooks/{identity}')
    def rename(identity:UUID,value:Rename):return service.rename(str(identity),value)
    @routes.delete('/v1/notebooks/{identity}')
    def remove(identity:UUID,value:Remove):return service.remove(str(identity),value)
    @routes.post('/v1/notes/{identity}/prepare-optimization')
    def prepare(identity:UUID,value:Remove):return service.prepare_reading(str(identity),value)
    @routes.get('/v1/notes/{identity}/revisions')
    def reading_history(identity:UUID):
        from .notes import Notes
        Notes(service.db)._get(str(identity))
        return {'items':service.rows('SELECT * FROM reading_note_revisions WHERE note_id=? ORDER BY version DESC',(str(identity),))}
    @routes.post('/v1/topics/{identity}/move-preview')
    def preview(identity:UUID,value:dict):
        try:parent=str(UUID(value['parent_id'])) if value.get('parent_id') else None
        except (ValueError,TypeError):raise HTTPException(422,detail='INVALID_INPUT') from None
        return service.move_preview(str(identity),parent)
    return routes
