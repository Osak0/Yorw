"""Transactional topic trees and append-only manual Wiki revisions."""
from datetime import datetime, timezone
import json
from uuid import UUID, uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from .storage.database import Database
from .source_status import source_status


class TopicFields(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=120, strict=True)
    parent_id: UUID | None = None


class CreateTopic(TopicFields):
    id: UUID


class UpdateTopic(TopicFields):
    version: int = Field(ge=1, strict=True)


class RemoveTopic(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: int = Field(ge=1, strict=True)


class SaveBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    base_revision_id: UUID
    body_md: str = Field(max_length=200_000, strict=True)


class Garden:
    def __init__(self, database: Database):
        self.db = database

    def _rows(self, query, args=()):
        cursor = self.db.connection.execute(query,args)
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns,row)) for row in cursor.fetchall()]

    def _topic(self, identity):
        rows = self._rows('SELECT id,parent_id,title,current_revision_id,version,created_at,updated_at FROM topics WHERE id=? AND deleted_at IS NULL',(identity,))
        if not rows:
            raise HTTPException(404,detail='TOPIC_NOT_FOUND')
        return rows[0]

    def _revision(self, identity, topic_id):
        rows = self._rows('SELECT * FROM revisions WHERE id=? AND topic_id=?',(identity,topic_id))
        if not rows:
            raise HTTPException(409,detail='REVISION_CONFLICT')
        revision = rows[0]
        revision['sources'] = source_status(self.db, json.loads(revision.pop('sources_json')))
        return revision

    def _parent(self, identity, parent_id):
        # Walk the proposed parent's ancestry, within the same serialized transaction.
        seen = {identity}
        while parent_id is not None:
            if parent_id in seen:
                raise HTTPException(409,detail='TOPIC_CYCLE')
            seen.add(parent_id)
            parent_id = self._topic(parent_id)['parent_id']

    def list(self):
        with self.db.lock:
            return {'items':self._rows('SELECT id,parent_id,title,current_revision_id,version,created_at,updated_at FROM topics WHERE deleted_at IS NULL ORDER BY created_at,id')}

    def get(self, identity):
        with self.db.lock:
            topic = self._topic(identity)
            return {'topic':topic,'revision':self._revision(topic['current_revision_id'],identity)}

    def create(self, value: CreateTopic):
        identity = str(value.id)
        parent_id = str(value.parent_id) if value.parent_id else None
        with self.db.write() as conn:
            existing = self._rows('SELECT id FROM topics WHERE id=?',(identity,))
            if existing:
                current = self.get(identity)
                if current['topic']['title']==value.title and current['topic']['parent_id']==parent_id and current['topic']['version']==1:
                    return current
                raise HTTPException(409,detail='TOPIC_CONFLICT')
            self._parent(identity,parent_id)
            timestamp = datetime.now(timezone.utc).isoformat()
            revision_id = str(uuid4())
            conn.execute('INSERT INTO topics(id,parent_id,title,created_at,updated_at) VALUES(?,?,?,?,?)',(identity,parent_id,value.title,timestamp,timestamp))
            conn.execute("INSERT INTO revisions(id,topic_id,ordinal,body_md,origin,created_at) VALUES(?,?,1,'','manual',?)",(revision_id,identity,timestamp))
            conn.execute('UPDATE topics SET current_revision_id=? WHERE id=?',(revision_id,identity))
            return self.get(identity)

    def update(self, identity, value: UpdateTopic):
        with self.db.write() as conn:
            topic = self._topic(identity)
            if topic['version']!=value.version:
                raise HTTPException(409,detail='TOPIC_CONFLICT')
            parent_id = str(value.parent_id) if value.parent_id else None
            self._parent(identity,parent_id)
            if topic['title']!=value.title or topic['parent_id']!=parent_id:
                conn.execute('UPDATE topics SET title=?,parent_id=?,version=version+1,updated_at=? WHERE id=?',
                             (value.title,parent_id,datetime.now(timezone.utc).isoformat(),identity))
            return self.get(identity)

    def remove(self, identity, value: RemoveTopic):
        """Remove one topic, preserving immutable history and promoting its children."""
        with self.db.write() as conn:
            topic = self._topic(identity)
            if topic['version'] != value.version:
                raise HTTPException(409, detail='TOPIC_CONFLICT')
            timestamp = datetime.now(timezone.utc).isoformat()
            conn.execute('UPDATE topics SET parent_id=?,version=version+1,updated_at=? '
                         'WHERE parent_id=? AND deleted_at IS NULL',
                         (topic['parent_id'], timestamp, identity))
            conn.execute('UPDATE topics SET deleted_at=?,version=version+1,updated_at=? WHERE id=?',
                         (timestamp, timestamp, identity))
            conn.execute('DELETE FROM document_topics WHERE topic_id=?', (identity,))
            conn.execute("DELETE FROM knowledge_sources WHERE kind='wiki' AND object_id=?", (identity,))
            return {'removed': True, 'items': self.list()['items']}

    def save(self, identity, value: SaveBody):
        with self.db.write() as conn:
            topic = self._topic(identity)
            current = self._revision(topic['current_revision_id'],identity)
            base = str(value.base_revision_id)
            if topic['current_revision_id']!=base:
                # Lost-response retry of the immediately preceding identical save.
                if current['base_revision_id']==base and current['body_md']==value.body_md and current['origin']=='manual':
                    return self.get(identity)
                raise HTTPException(409,detail='REVISION_CONFLICT')
            if current['body_md']==value.body_md:
                return self.get(identity)
            revision_id = str(uuid4())
            timestamp = datetime.now(timezone.utc).isoformat()
            conn.execute("INSERT INTO revisions(id,topic_id,ordinal,body_md,sources_json,origin,base_revision_id,created_at) VALUES(?,?,?,?,?,'manual',?,?)",
                         (revision_id,identity,current['ordinal']+1,value.body_md,conn.execute('SELECT sources_json FROM revisions WHERE id=?',(base,)).fetchone()[0],base,timestamp))
            conn.execute('UPDATE topics SET current_revision_id=?,version=version+1,updated_at=? WHERE id=?',(revision_id,timestamp,identity))
            return self.get(identity)

    def history(self, identity):
        with self.db.lock:
            self._topic(identity)
            # Return full immutable snapshots only when explicitly opening history.
            rows = self._rows('SELECT id FROM revisions WHERE topic_id=? ORDER BY ordinal DESC',(identity,))
            return {'items':[self._revision(row['id'],identity) for row in rows]}


def router(database):
    garden = Garden(database)
    routes = APIRouter()

    @routes.get('/v1/topics')
    def list_topics():
        return garden.list()

    @routes.post('/v1/topics')
    def create_topic(value: CreateTopic):
        return garden.create(value)

    @routes.get('/v1/topics/{identity}')
    def get_topic(identity: UUID):
        return garden.get(str(identity))

    @routes.patch('/v1/topics/{identity}')
    def update_topic(identity: UUID, value: UpdateTopic):
        return garden.update(str(identity),value)

    @routes.delete('/v1/topics/{identity}')
    def remove_topic(identity: UUID, value: RemoveTopic):
        return garden.remove(str(identity), value)

    @routes.post('/v1/topics/{identity}/revisions')
    def save_body(identity: UUID, value: SaveBody):
        return garden.save(str(identity),value)

    @routes.get('/v1/topics/{identity}/revisions')
    def history(identity: UUID):
        return garden.history(str(identity))

    return routes
