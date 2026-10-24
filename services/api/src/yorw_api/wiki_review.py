"""Explicit decisions, atomic revision creation and idempotent local retries."""
import json
import re
from uuid import UUID, uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from .garden import Garden
from .library import now


class Decision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    base_revision_id: UUID


class Accept(Decision):
    body_md: str = Field(min_length=1, max_length=200_000, strict=True)


class WikiReview:
    def __init__(self, suggestions):
        self.suggestions = suggestions
        self.db = suggestions.db
        self.garden = Garden(self.db)

    def _retry(self, action, topic, suggestion, value):
        rows = self.garden._rows('SELECT * FROM wiki_decisions WHERE request_id=?', (str(value.request_id),))
        if not rows:
            return None
        row = rows[0]
        if row['action'] != action or row['topic_id'] != topic or row['suggestion_id'] != suggestion or json.loads(row['request_json']) != value.model_dump(mode='json'):
            raise HTTPException(409, detail='REQUEST_CONFLICT')
        # Return current pointer as well as the original operation's revision, never replay it.
        return self._result(row)

    def _result(self, row):
        return {'view': self.garden.get(row['topic_id']), 'decision': {k: row[k] for k in ('request_id','action','revision_id','suggestion_id')}}

    def _record(self, conn, action, topic, suggestion, revision, value):
        conn.execute('INSERT INTO wiki_decisions VALUES(?,?,?,?,?,?,?)', (str(value.request_id),topic,suggestion,action,revision,json.dumps(value.model_dump(mode='json')),now()))
        return self._result(self.garden._rows('SELECT * FROM wiki_decisions WHERE request_id=?', (str(value.request_id),))[0])

    def decide(self, identity, value, accept):
        with self.db.write() as conn:
            item = self.suggestions.get(identity)
            topic = item['topic_id']
            action = 'accept' if accept else 'reject'
            retry = self._retry(action, topic, identity, value)
            if retry:
                return retry
            if self.garden._rows('SELECT request_id FROM wiki_decisions WHERE suggestion_id=?', (identity,)):
                raise HTTPException(409, detail='SUGGESTION_DECIDED')
            if item['status'] != 'completed':
                raise HTTPException(409, detail='SUGGESTION_NOT_READY')
            current = self.garden.get(topic)['revision']
            if current['id'] != str(value.base_revision_id):
                raise HTTPException(409, detail='REVISION_CONFLICT')
            if not accept:
                return self._record(conn, action, topic, identity, None, value)
            if current['id'] != item['base_revision_id']:
                raise HTTPException(409, detail='REVISION_CONFLICT')
            if not all(s['available'] for s in item['sources']):
                raise HTTPException(409, detail='MATERIAL_CHANGED')
            refs = [int(n) for n in re.findall(r'\[S(\d+)\]', value.body_md)]
            if not value.body_md.strip() or not refs or any(n < 1 or n > len(item['sources']) for n in refs):
                raise HTTPException(422, detail='INVALID_CITATION')
            raw = conn.execute('SELECT sources_json FROM suggestions WHERE id=?', (identity,)).fetchone()[0]
            revision = self._insert(conn, topic, current, value.body_md, raw, 'ai_accepted')
            return self._record(conn, action, topic, identity, revision, value)

    def _insert(self, conn, topic, current, body, sources_json, origin, restored=None):
        revision, timestamp = str(uuid4()), now()
        conn.execute('INSERT INTO revisions(id,topic_id,ordinal,body_md,sources_json,origin,base_revision_id,restored_from_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)', (revision,topic,current['ordinal']+1,body,sources_json,origin,current['id'],restored,timestamp))
        conn.execute('UPDATE topics SET current_revision_id=?,version=version+1,updated_at=? WHERE id=?', (revision,timestamp,topic))
        return revision

    def restore(self, topic, revision, value):
        with self.db.write() as conn:
            # Bind restored target into the replay payload, independently of current pointer.
            retry = self._retry('restore', topic, None, value)
            if retry:
                previous = self.garden._revision(retry['decision']['revision_id'], topic)
                if previous['restored_from_id'] != revision:
                    raise HTTPException(409, detail='REQUEST_CONFLICT')
                return retry
            current = self.garden.get(topic)['revision']
            if current['id'] != str(value.base_revision_id):
                raise HTTPException(409, detail='REVISION_CONFLICT')
            self.garden._revision(revision, topic)
            body, sources = conn.execute('SELECT body_md,sources_json FROM revisions WHERE id=? AND topic_id=?', (revision,topic)).fetchone()
            created = self._insert(conn, topic, current, body, sources, 'restore', revision)
            return self._record(conn, 'restore', topic, None, created, value)


def router(suggestions):
    service, routes = WikiReview(suggestions), APIRouter()

    @routes.post('/v1/suggestions/{identity}/accept')
    def accept(identity: UUID, value: Accept):
        return service.decide(str(identity), value, True)

    @routes.post('/v1/suggestions/{identity}/reject')
    def reject(identity: UUID, value: Decision):
        return service.decide(str(identity), value, False)

    @routes.post('/v1/topics/{identity}/revisions/{revision}/restore')
    def restore(identity: UUID, revision: UUID, value: Decision):
        return service.restore(str(identity), str(revision), value)

    return routes
