"""Logical library folders. Original files and evidence IDs never move."""
import unicodedata
from uuid import uuid4, UUID
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

class Change(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str | None = None
    parent_id: UUID | None = None
    version: int = Field(default=0, ge=0)

class Assignment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    folder_id: UUID | None = None
    documents: dict[UUID, int] = Field(min_length=1, max_length=500)

class Folders:
    def __init__(self, library):
        self.library, self.db = library, library.db

    def list(self):
        return {'items': self.library.rows('SELECT * FROM library_folders ORDER BY name COLLATE NOCASE,id')}

    def _row(self, conn, identity):
        row = conn.execute('SELECT parent_id,name,version FROM library_folders WHERE id=?',(identity,)).fetchone()
        if row is None: raise HTTPException(404, detail='FOLDER_NOT_FOUND')
        return row

    def save(self, change, identity=None):
        parent = str(change.parent_id) if change.parent_id else None
        name = unicodedata.normalize('NFC', change.name or '').strip()
        if not name or len(name)>100 or any(ord(c)<32 or c in '/\\' for c in name):
            raise HTTPException(422, detail='INVALID_FOLDER_NAME')
        with self.db.write() as conn:
            if identity and self._row(conn,identity)[2]!=change.version:
                raise HTTPException(409,detail='FOLDER_CONFLICT')
            cursor, seen = parent, {identity} if identity else set()
            while cursor:
                if cursor in seen: raise HTTPException(422,detail='FOLDER_CYCLE')
                seen.add(cursor)
                if len(seen)>32: raise HTTPException(422,detail='FOLDER_DEPTH_LIMIT')
                cursor=self._row(conn,cursor)[0]
            # Validate depth of the entire resulting tree, including moved descendants.
            tree={r[0]:r[1] for r in conn.execute('SELECT id,parent_id FROM library_folders')}
            key=identity or str(uuid4()); tree[key]=parent
            for node in tree:
                path=set()
                while node:
                    if node in path or len(path)>=32: raise HTTPException(422,detail='FOLDER_DEPTH_LIMIT')
                    path.add(node);node=tree[node]
            for row in conn.execute('SELECT id,name FROM library_folders WHERE parent_id IS ?',(parent,)):
                if row[0]!=identity and unicodedata.normalize('NFC',row[1]).casefold()==name.casefold():
                    raise HTTPException(409,detail='FOLDER_NAME_EXISTS')
            if identity:
                conn.execute('UPDATE library_folders SET parent_id=?,name=?,version=version+1 WHERE id=?',(parent,name,identity))
            else: conn.execute('INSERT INTO library_folders(id,parent_id,name) VALUES(?,?,?)',(key,parent,name))
        return self.list()

    def remove(self, identity, version):
        with self.db.write() as conn:
            parent,_,current=self._row(conn,identity)
            if current!=version: raise HTTPException(409,detail='FOLDER_CONFLICT')
            # Prevent promoting identically named siblings; retain everything on conflict.
            names=[r[0].casefold() for r in conn.execute('SELECT name FROM library_folders WHERE parent_id IS ? AND id!=?',(parent,identity))]
            children=list(conn.execute('SELECT name FROM library_folders WHERE parent_id=?',(identity,)))
            if any(r[0].casefold() in names for r in children): raise HTTPException(409,detail='FOLDER_NAME_EXISTS')
            conn.execute('UPDATE library_folders SET parent_id=?,version=version+1 WHERE parent_id=?',(parent,identity))
            conn.execute('UPDATE documents SET folder_id=?,version=version+1 WHERE folder_id=?',(parent,identity))
            conn.execute('DELETE FROM library_folders WHERE id=?',(identity,))
        return self.list()

    def assign(self, value: Assignment):
        target=str(value.folder_id) if value.folder_id else None
        with self.db.write() as conn:
            if target:self._row(conn,target)
            for identity,version in value.documents.items():
                row=conn.execute('SELECT version FROM documents WHERE id=? AND deleted_at IS NULL',(str(identity),)).fetchone()
                if not row or row[0]!=version:raise HTTPException(409,detail='DOCUMENT_CONFLICT')
            for identity in value.documents:
                conn.execute('UPDATE documents SET folder_id=?,version=version+1 WHERE id=?',(target,str(identity)))
        return {'assigned':len(value.documents)}

def router(library):
    service=Folders(library);routes=APIRouter()
    routes.add_api_route('/v1/library-folders',service.list,methods=['GET'])
    @routes.post('/v1/library-folders')
    def create(value:Change):return service.save(value)
    @routes.patch('/v1/library-folders/{identity}')
    def update(identity:UUID,value:Change):return service.save(value,str(identity))
    @routes.delete('/v1/library-folders/{identity}')
    def remove(identity:UUID,version:int):return service.remove(str(identity),version)
    @routes.get('/v1/library-original/{identity}')
    def original(identity:UUID):
        library.document(str(identity))
        row=library.rows('SELECT relative_path FROM documents WHERE id=?',(str(identity),))[0]
        from pathlib import Path
        extension=Path(row['relative_path']).suffix.lstrip('.')
        path=library.workspace.document_path(str(identity),extension)
        if not path.is_relative_to(library.workspace.root.resolve()) or not path.is_file():raise HTTPException(404,detail='ORIGINAL_MISSING')
        return {'path':str(path)}
    routes.add_api_route('/v1/library-folder-assignment',service.assign,methods=['POST'])
    return routes
