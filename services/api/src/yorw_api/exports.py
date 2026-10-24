"""Bounded, consistent saved-content ZIP snapshots; not a workspace backup."""
from io import BytesIO
import json
from uuid import UUID, uuid4
from zipfile import ZipFile, ZIP_DEFLATED
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from .garden import Garden
from .notes import Notes
from .library import now

MAX_OBJECTS = 500
MAX_CONTENT_BYTES = 20 * 1024 * 1024


class ExportSelection(BaseModel):
    model_config = ConfigDict(extra='forbid')
    note_ids: list[UUID] = Field(default_factory=list, max_length=MAX_OBJECTS)
    topic_ids: list[UUID] = Field(default_factory=list, max_length=MAX_OBJECTS)


class Exports:
    def __init__(self, database):
        self.db, self.garden, self.notes = database, Garden(database), Notes(database)

    def catalog(self):
        with self.db.lock:
            notes = self.garden._rows('SELECT n.id,n.body_md,n.document_id,n.version,d.title,d.original_name,d.deleted_at FROM notes n JOIN documents d ON d.id=n.document_id ORDER BY n.updated_at DESC,n.id')
            topics = self.garden.list()['items']
            return {'notes': [{'id': n['id'], 'label': (n['body_md'].splitlines() or ['空笔记'])[0][:100], 'document_title': n['title'] or n['original_name'], 'document_available': n['deleted_at'] is None, 'version': n['version']} for n in notes],
                    'topics': topics}

    def create(self, value):
        note_ids, topic_ids = list(map(str,value.note_ids)), list(map(str,value.topic_ids))
        if not 1 <= len(note_ids)+len(topic_ids) <= MAX_OBJECTS or len(set(note_ids)) != len(note_ids) or len(set(topic_ids)) != len(topic_ids):
            raise HTTPException(422, detail='INVALID_EXPORT_SELECTION')
        identity, timestamp = str(uuid4()), now()
        # Serialize complete snapshots under the same lock as all writers. Paths use UUIDs,
        # never a user-controlled title; raw saved Markdown is a separate untouched entry.
        with self.db.lock:
            entries = []
            for kind, identities in (('notes',note_ids),('wiki',topic_ids)):
                for selected in identities:
                    if kind == 'notes':
                        item = self.notes._get(selected)
                        doc = self.garden._rows('SELECT title,original_name FROM documents WHERE id=?',(item['document_id'],))[0]
                        title = doc['title'] or doc['original_name']
                    else:
                        view = self.garden.get(selected)
                        item, title = view['revision'], view['topic']['title']
                    entries.append({'kind':kind,'id':selected,'title':title,'file':f'{kind}/{selected}.md','snapshot':item})
            manifest = {'format':'yorw-content-export-v1','created_at':timestamp,'workspace_id':self.db.workspace_info()['workspace_id'],
                        'notice':'内容导出，不是完整备份；不含 PDF、密钥、模型配置、聊天历史、未采纳建议、未保存草稿或完整修订历史。',
                        'items':[{k:v for k,v in e.items() if k!='snapshot'} | {'saved_version': e['snapshot'].get('version'), 'revision_id': e['snapshot']['id'] if e['kind']=='wiki' else None} for e in entries]}
            files = {'manifest.json':json.dumps(manifest,ensure_ascii=False,indent=2).encode('utf-8'),
                     'README.md':('# 知栖内容导出\n\n'+manifest['notice']+'\n\nMarkdown 文件保持已保存正文原样。每份正文对应 .sources.json 和 .sources.md 来源快照；引用编号只在各自文件内有效。来源可用性是导出时状态，不代表已验证事实。\n').encode('utf-8')}
            for entry in entries:
                snapshot = entry['snapshot']
                file = entry['file']
                metadata = {k:v for k,v in snapshot.items() if k!='body_md'}
                metadata.update({'title':entry['title'],'exported_at':timestamp})
                files[file] = snapshot['body_md'].encode('utf-8')
                files[file+'.sources.json'] = json.dumps(metadata,ensure_ascii=False,indent=2).encode('utf-8')
                files[file+'.sources.md'] = ('# 来源快照\n\n'+entry['title']+'\n\n```json\n'+json.dumps(metadata,ensure_ascii=False,indent=2)+'\n```\n').encode('utf-8')
            if sum(map(len,files.values())) > MAX_CONTENT_BYTES:
                raise HTTPException(422, detail='EXPORT_TOO_LARGE')
            buffer = BytesIO()
            with ZipFile(buffer,'w',ZIP_DEFLATED) as archive:
                for file, data in files.items():
                    archive.writestr(file,data)
            data = buffer.getvalue()
            if len(data) > MAX_CONTENT_BYTES:
                raise HTTPException(422, detail='EXPORT_TOO_LARGE')
            path = self._path(identity)
            try:
                with path.open('xb') as output:
                    output.write(data)
                with self.db.write() as conn:
                    conn.execute("INSERT INTO tasks(id,kind,status,stage,input_json,result_json,created_at,updated_at) VALUES(?,'export','succeeded','EXPORT_READY',?,?,?,?)", (identity,json.dumps(value.model_dump(mode='json')),json.dumps({'count':len(entries),'bytes':len(data)}),timestamp,timestamp))
            except Exception:
                path.unlink(missing_ok=True)
                raise
            return {'task_id':identity,'count':len(entries),'bytes':len(data)}

    def _path(self, identity):
        path = self.db.workspace.root / 'tmp' / f'export-{UUID(identity)}.zip'
        if path.is_symlink() or path.resolve() != path:
            raise HTTPException(409, detail='EXPORT_UNAVAILABLE')
        return path

    def file(self, identity):
        with self.db.lock:
            rows = self.garden._rows("SELECT result_json FROM tasks WHERE id=? AND kind='export' AND status='succeeded'",(identity,))
            if not rows:
                raise HTTPException(404, detail='EXPORT_UNAVAILABLE')
            path = self._path(identity)
            if not path.exists() or path.stat().st_size > MAX_CONTENT_BYTES:
                raise HTTPException(404, detail='EXPORT_UNAVAILABLE')
            return path.read_bytes()


def router(database):
    service, routes = Exports(database), APIRouter()

    @routes.get('/v1/exports/catalog')
    def catalog():
        return service.catalog()

    @routes.post('/v1/exports')
    def create(value: ExportSelection):
        return service.create(value)

    @routes.get('/v1/exports/{identity}/file')
    def file(identity: UUID):
        return Response(service.file(str(identity)), media_type='application/zip')

    return routes
