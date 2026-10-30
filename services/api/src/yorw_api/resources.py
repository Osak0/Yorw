"""Read-only document resource aggregation for the resource work tab."""
import json
import re
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from .library import Library, now
from .search_history import SearchHistory

EXCERPT = 300
MAX_RELATION_DESCRIPTION = 500
MAX_CANDIDATES = 20


class RelationInput(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    description: str = Field(default='', max_length=MAX_RELATION_DESCRIPTION)


class DocumentResources:
    def __init__(self, library: Library):
        self.library, self.db = library, library.db
        self.history = SearchHistory(self.db)

    def _tags(self, document_id: str) -> list[dict]:
        return self.library.rows(
            'SELECT tag,tag_key FROM document_tags WHERE document_id=? ORDER BY created_at,tag_key',
            (document_id,))

    def _summary(self, row: dict) -> dict:
        return {
            'id': row['id'], 'original_name': row['original_name'], 'title': row['title'],
            'authors': json.loads(row['authors_json']), 'year': row['year'],
            'tags': [item['tag'] for item in self._tags(row['id'])],
            'document_available': row.get('deleted_at') is None,
        }

    def _pair(self, first: str, second: str) -> tuple[str, str]:
        return (first, second) if first < second else (second, first)

    def candidates(self, document_id: str, query: str = '') -> dict:
        current = self.library.document(document_id)
        text = (query or '').strip().casefold()
        if len(text) > 200:
            raise HTTPException(422, detail='INVALID_INPUT')
        with self.db.lock:
            rows = self.library.rows(
                "SELECT * FROM documents WHERE deleted_at IS NULL AND id!=? AND ("
                "?='' OR instr(lower(coalesce(title,'')),?)>0 OR instr(lower(original_name),?)>0 "
                "OR instr(lower(authors_json),?)>0 OR CAST(year AS TEXT)=? "
                "OR EXISTS(SELECT 1 FROM document_tags t WHERE t.document_id=documents.id AND instr(t.tag_key,?)>0)) "
                "ORDER BY created_at DESC,id DESC LIMIT ?",
                (document_id, text, text, text, text, text, text, MAX_CANDIDATES))
            mine = {item['tag_key']: item['tag'] for item in self._tags(document_id)}
            items = []
            for row in rows:
                shared = [mine[key] for key in mine if any(item['tag_key'] == key for item in self._tags(row['id']))]
                items.append({**self._summary(row), 'shared_tags': shared})
        return {'items': items}

    def tag_matches(self, document_id: str) -> list[dict]:
        with self.db.lock:
            rows = self.library.rows(
                'SELECT other.document_id AS other_id,mine.tag AS tag,mine.tag_key AS tag_key '
                'FROM document_tags mine JOIN document_tags other '
                'ON other.tag_key=mine.tag_key AND other.document_id!=mine.document_id '
                'JOIN documents d ON d.id=other.document_id AND d.deleted_at IS NULL '
                'WHERE mine.document_id=? AND NOT EXISTS ('
                ' SELECT 1 FROM document_relations r WHERE (r.low_id=min(mine.document_id,other.document_id) '
                ' AND r.high_id=max(mine.document_id,other.document_id))) '
                'ORDER BY other.document_id,tag_key', (document_id,))
            shared: dict[str, list[str]] = {}
            for row in rows:
                tags = shared.setdefault(row['other_id'], [])
                if row['tag'] not in tags:
                    tags.append(row['tag'])
            items = []
            for other_id, tags in list(shared.items())[:MAX_CANDIDATES]:
                document = self.library.rows('SELECT * FROM documents WHERE id=?', (other_id,))[0]
                items.append({'document': self._summary(document), 'shared_tags': tags})
        return items

    def _relation_view(self, document_id: str, other_id: str) -> dict:
        document = self.library.rows('SELECT * FROM documents WHERE id=?', (other_id,))[0]
        low, high = self._pair(document_id, other_id)
        row = self.library.rows('SELECT * FROM document_relations WHERE low_id=? AND high_id=?', (low, high))[0]
        return {'document': self._summary(document), 'document_available': document['deleted_at'] is None,
                'description': row['description'], 'created_at': row['created_at'], 'updated_at': row['updated_at']}

    def relations(self, document_id: str) -> dict:
        self.library.document(document_id)
        with self.db.lock:
            rows = self.library.rows(
                'SELECT CASE WHEN low_id=? THEN high_id ELSE low_id END AS other_id '
                'FROM document_relations WHERE low_id=? OR high_id=? ORDER BY updated_at DESC,other_id',
                (document_id, document_id, document_id))
            return {'items': [self._relation_view(document_id, row['other_id']) for row in rows]}

    def add_relation(self, document_id: str, related_id: str, description: str = '') -> dict:
        self.library.document(document_id)
        self.library.document(related_id)
        if document_id == related_id:
            raise HTTPException(422, detail='RELATION_SELF')
        text = (description or '').strip()
        if len(text) > MAX_RELATION_DESCRIPTION:
            raise HTTPException(422, detail='INVALID_INPUT')
        low, high = self._pair(document_id, related_id)
        with self.db.write() as conn:
            existing = self.library.rows(
                'SELECT * FROM document_relations WHERE low_id=? AND high_id=?', (low, high))
            if existing:
                if existing[0]['description'] != text:
                    conn.execute('UPDATE document_relations SET description=?,updated_at=? WHERE low_id=? AND high_id=?',
                                 (text, now(), low, high))
            else:
                timestamp = now()
                conn.execute('INSERT INTO document_relations(low_id,high_id,description,created_at,updated_at) VALUES(?,?,?,?,?)',
                             (low, high, text, timestamp, timestamp))
        return {'relation': self._relation_view(document_id, related_id)}

    def remove_relation(self, document_id: str, related_id: str) -> dict:
        low, high = self._pair(document_id, related_id)
        with self.db.write() as conn:
            cursor = conn.execute('DELETE FROM document_relations WHERE low_id=? AND high_id=?', (low, high))
        return {'removed': cursor.rowcount > 0}

    def _topic_paths(self) -> dict[str, list[str]]:
        topics = self.library.rows('SELECT id,parent_id,title FROM topics WHERE deleted_at IS NULL')
        by_id = {item['id']: item for item in topics}
        paths = {}
        for identity in by_id:
            chain, seen, current = [], set(), identity
            while current in by_id and current not in seen:
                seen.add(current)
                chain.append(by_id[current]['title'])
                current = by_id[current]['parent_id']
            paths[identity] = list(reversed(chain))
        return paths

    def document_topics(self, document_id: str) -> list[dict]:
        self.library.document(document_id)
        with self.db.lock:
            rows = self.library.rows(
                'SELECT t.* FROM document_topics dt JOIN topics t ON t.id=dt.topic_id '
                'WHERE dt.document_id=? AND t.deleted_at IS NULL ORDER BY dt.rowid', (document_id,))
            paths = self._topic_paths()
            return [{'topic': row, 'path': paths.get(row['id'], [row['title']])} for row in rows]

    def add_document_topic_with(self, conn, document_id: str, topic_id: str) -> dict:
        """Shared relation invariant for callers already holding a transaction."""
        self.library.document(document_id)
        if not self.library.rows('SELECT id FROM topics WHERE id=? AND deleted_at IS NULL', (topic_id,)):
            raise HTTPException(404, detail='TOPIC_NOT_FOUND')
        conn.execute('INSERT OR IGNORE INTO document_topics(document_id,topic_id,created_at) VALUES(?,?,?)',
                     (document_id, topic_id, now()))
        return {'linked': True}

    def add_document_topic(self, document_id: str, topic_id: str) -> dict:
        with self.db.write() as conn:
            return self.add_document_topic_with(conn, document_id, topic_id)

    def remove_document_topic(self, document_id: str, topic_id: str) -> dict:
        with self.db.write() as conn:
            conn.execute('DELETE FROM document_topics WHERE document_id=? AND topic_id=?', (document_id, topic_id))
        return {'linked': False}

    def _documents(self, identities: list[str]) -> dict[str, dict]:
        result = {}
        for identity in identities:
            rows = self.library.rows('SELECT * FROM documents WHERE id=?', (identity,))
            if rows:
                result[identity] = self._summary(rows[0])
        return result

    def topic_materials(self, topic_id: str) -> dict:
        topic = self.library.rows('SELECT * FROM topics WHERE id=? AND deleted_at IS NULL', (topic_id,))
        if not topic:
            raise HTTPException(404, detail='TOPIC_NOT_FOUND')
        with self.db.lock:
            descendants = [row['id'] for row in self.library.rows(
                'WITH RECURSIVE descendants(id) AS ('
                ' SELECT id FROM topics WHERE id=? AND deleted_at IS NULL UNION'
                ' SELECT t.id FROM topics t JOIN descendants d ON t.parent_id=d.id WHERE t.deleted_at IS NULL)'
                ' SELECT id FROM descendants', (topic_id,))]
            direct_rows = self.library.rows(
                'SELECT d.*,dt.created_at AS linked_at FROM document_topics dt JOIN documents d ON d.id=dt.document_id '
                'WHERE dt.topic_id=? ORDER BY dt.rowid,d.created_at,d.id', (topic_id,))
            direct_ids = [row['id'] for row in direct_rows]
            inherited_rows = self.library.rows(
                'SELECT d.*,t.id AS source_topic_id,t.title AS source_topic_title '
                'FROM document_topics dt JOIN documents d ON d.id=dt.document_id JOIN topics t ON t.id=dt.topic_id '
                'WHERE dt.topic_id IN (' + ','.join('?' for _ in descendants) + ') AND dt.topic_id!=? '
                'ORDER BY d.created_at,d.id,t.title',
                (*descendants, topic_id)) if descendants else []
            inherited: dict[str, dict] = {}
            for row in inherited_rows:
                if row['id'] in direct_ids:
                    continue
                entry = inherited.setdefault(row['id'], {'document': self._summary(row), 'topics': []})
                if {'id': row['source_topic_id'], 'title': row['source_topic_title']} not in entry['topics']:
                    entry['topics'].append({'id': row['source_topic_id'], 'title': row['source_topic_title']})
            direct = [{'document': self._summary(row), 'linked_at': row['linked_at']} for row in direct_rows]
            scope_ids = list(dict.fromkeys(direct_ids + list(inherited)))
            notes = []
            if scope_ids:
                note_rows = self.library.rows(
                    'SELECT n.id,n.document_id,n.body_md,n.version,n.sources_json,n.created_at,n.updated_at,d.title,d.original_name,d.deleted_at '
                    'FROM notes n JOIN documents d ON d.id=n.document_id WHERE n.document_id IN (' +
                    ','.join('?' for _ in scope_ids) + ') ORDER BY n.created_at,n.id', scope_ids)
                topic_labels: dict[str, list[str]] = {}
                for row in direct_rows:
                    topic_labels.setdefault(row['id'], []).append(topic[0]['title'])
                for row in inherited_rows:
                    labels = topic_labels.setdefault(row['id'], [])
                    if row['source_topic_title'] not in labels:
                        labels.append(row['source_topic_title'])
                seen = set()
                for row in note_rows:
                    if row['id'] in seen:
                        continue
                    seen.add(row['id'])
                    try:
                        sources = json.loads(row['sources_json'])
                    except (TypeError, ValueError):
                        sources = []
                    notes.append({
                        'id': row['id'], 'document_id': row['document_id'],
                        'document_title': row['title'] or row['original_name'],
                        'document_available': row['deleted_at'] is None,
                        'direct': row['document_id'] in direct_ids,
                        'topics': topic_labels.get(row['document_id'], []),
                        'excerpt': row['body_md'][:EXCERPT], 'version': row['version'],
                        'sources_count': len(sources) if isinstance(sources, list) else 0,
                        'created_at': row['created_at'], 'updated_at': row['updated_at'],
                    })
        return {'topic': topic[0], 'direct': direct, 'inherited': list(inherited.values()), 'notes': notes}

    def search_documents(self, query: str = '') -> dict:
        text = (query or '').strip().casefold()
        if len(text) > 200:
            raise HTTPException(422, detail='INVALID_INPUT')
        with self.db.lock:
            rows = self.library.rows(
                "SELECT * FROM documents WHERE deleted_at IS NULL AND ("
                "?='' OR instr(lower(coalesce(title,'')),?)>0 OR instr(lower(original_name),?)>0 "
                "OR instr(lower(authors_json),?)>0 OR CAST(year AS TEXT)=? "
                "OR EXISTS(SELECT 1 FROM document_tags t WHERE t.document_id=documents.id AND instr(t.tag_key,?)>0)) "
                "ORDER BY created_at DESC,id DESC LIMIT ?",
                (text, text, text, text, text, text, MAX_CANDIDATES))
            return {'items': [self._summary(row) for row in rows]}

    def _notes(self, document_id: str) -> list[dict]:
        cursor = self.db.connection.execute(
            'SELECT id,body_md,version,created_at,updated_at,sources_json FROM notes WHERE document_id=? ORDER BY created_at,id',
            (document_id,))
        names = [column[0] for column in cursor.description]
        result = []
        for row in cursor.fetchall():
            note = dict(zip(names, row))
            try:
                sources = json.loads(note.pop('sources_json'))
            except (TypeError, ValueError):
                sources = []
            note['excerpt'] = note.pop('body_md')[:EXCERPT]
            note['sources_count'] = len(sources) if isinstance(sources, list) else 0
            result.append(note)
        return result

    def _chat(self, document_id: str) -> list[dict]:
        cursor = self.db.connection.execute(
            'SELECT m.id,m.question,m.body_md,m.status,m.error_code,m.created_at,m.sources_json '
            'FROM messages m JOIN conversations c ON c.id=m.conversation_id '
            'WHERE c.document_id=? ORDER BY m.created_at,m.id', (document_id,))
        names = [column[0] for column in cursor.description]
        result = []
        for row in cursor.fetchall():
            message = dict(zip(names, row))
            try:
                sources = json.loads(message.pop('sources_json'))
            except (TypeError, ValueError):
                sources = []
            if not isinstance(sources, list):
                sources = []
            citations = sorted({int(value) for value in re.findall(r'\[S(\d+)\]', message['body_md'])
                               if 1 <= int(value) <= len(sources)})
            message['body_excerpt'] = message.pop('body_md')[:EXCERPT]
            message['sources_count'] = len(sources)
            message['citations'] = len(citations)
            result.append(message)
        return result

    def view(self, identity: str) -> dict:
        with self.db.lock:
            document = self.library.document(identity)
            return {
                'document': document,
                'topics': self.document_topics(identity),
                'related': self.relations(identity)['items'],
                'tag_matches': self.tag_matches(identity),
                'notes': self._notes(identity),
                'chat': self._chat(identity),
                'search_history': self.history.list(identity)['items'],
            }


def router(library: Library):
    service, routes = DocumentResources(library), APIRouter()

    @routes.get('/v1/documents/{identity}/resource')
    def resource(identity: UUID):
        return service.view(str(identity))

    @routes.get('/v1/documents/{identity}/related-candidates')
    def candidates(identity: UUID, query: str = Query(default='', max_length=200)):
        return service.candidates(str(identity), query)

    @routes.get('/v1/documents/{identity}/relations')
    def relations(identity: UUID):
        return service.relations(str(identity))

    @routes.put('/v1/documents/{identity}/relations/{related_id}')
    def add_relation(identity: UUID, related_id: UUID, value: RelationInput):
        return service.add_relation(str(identity), str(related_id), value.description)

    @routes.delete('/v1/documents/{identity}/relations/{related_id}')
    def remove_relation(identity: UUID, related_id: UUID):
        return service.remove_relation(str(identity), str(related_id))

    @routes.get('/v1/documents/search')
    def search_documents(query: str = Query(default='', max_length=200)):
        return service.search_documents(query)

    @routes.get('/v1/documents/{identity}/topics')
    def document_topics(identity: UUID):
        return {'items': service.document_topics(str(identity))}

    @routes.put('/v1/documents/{identity}/topics/{topic_id}')
    def add_document_topic(identity: UUID, topic_id: UUID):
        return service.add_document_topic(str(identity), str(topic_id))

    @routes.delete('/v1/documents/{identity}/topics/{topic_id}')
    def remove_document_topic(identity: UUID, topic_id: UUID):
        return service.remove_document_topic(str(identity), str(topic_id))

    @routes.get('/v1/topics/{identity}/materials')
    def topic_materials(identity: UUID):
        return service.topic_materials(str(identity))

    @routes.put('/v1/topics/{identity}/documents/{document_id}')
    def add_topic_document(identity: UUID, document_id: UUID):
        return service.add_document_topic(str(document_id), str(identity))

    @routes.delete('/v1/topics/{identity}/documents/{document_id}')
    def remove_topic_document(identity: UUID, document_id: UUID):
        return service.remove_document_topic(str(document_id), str(identity))

    return routes
