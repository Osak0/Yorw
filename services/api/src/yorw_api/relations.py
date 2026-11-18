"""One invariant and candidate service for manual, enrichment and research entrypoints."""
import re
from fastapi import HTTPException
from .library import now


class Relations:
    def __init__(self, library):
        self.library, self.db = library, library.db

    def entity(self, kind, identity):
        table = {'document': 'documents', 'topic': 'topics'}.get(kind)
        if not table:
            raise HTTPException(422, detail='INVALID_INPUT')
        rows = self.library.rows(f'SELECT * FROM {table} WHERE id=? AND deleted_at IS NULL' +
                                 (' AND notebook_only=0' if kind == 'topic' else ''), (identity,))
        if not rows:
            raise HTTPException(409, detail='MATERIAL_CHANGED')
        return rows[0]

    def pair(self, first_kind, first, second_kind, second, *, validate=True):
        if first_kind not in ('document','topic') or second_kind not in ('document','topic'):raise HTTPException(422,detail='INVALID_INPUT')
        if validate:self.entity(first_kind, first); self.entity(second_kind, second)
        if first_kind == second_kind:
            if first == second:
                raise HTTPException(422, detail='RELATION_SELF')
            low, high = sorted((first, second))
            return ('document_relations' if first_kind == 'document' else 'topic_relations', 'low_id', 'high_id', low, high)
        if first_kind == 'topic':
            first, second = second, first
        return ('document_topics', 'document_id', 'topic_id', first, second)

    def state(self, first_kind, first, second_kind, second):
        table, a, b, left, right = self.pair(first_kind, first, second_kind, second)
        return self.library.rows(f'SELECT * FROM {table} WHERE {a}=? AND {b}=?', (left, right))

    def link_with(self, conn, first_kind, first, second_kind, second, reason=''):
        table, a, b, left, right = self.pair(first_kind, first, second_kind, second)
        if len(reason) > 500:
            raise HTTPException(422, detail='INVALID_INPUT')
        stamp = now()
        if table == 'document_topics':
            conn.execute('INSERT OR IGNORE INTO document_topics VALUES(?,?,?)', (left, right, stamp))
        else:
            conn.execute(f'INSERT INTO {table} VALUES(?,?,?,?,?) ON CONFLICT(low_id,high_id) DO UPDATE SET description=excluded.description,updated_at=excluded.updated_at WHERE description<>excluded.description',
                         (left, right, reason, stamp, stamp))

    def remove_with(self, conn, first_kind, first, second_kind, second):
        table, a, b, left, right = self.pair(first_kind, first, second_kind, second,validate=False)
        return conn.execute(f'DELETE FROM {table} WHERE {a}=? AND {b}=?', (left, right)).rowcount>0

    def choices(self,document_id,query=''):
        """Manual document picker: browsing is allowed even without relevance hits."""
        self.entity('document',document_id);text=query.strip().casefold()
        if len(text)>200:raise HTTPException(422,detail='INVALID_INPUT')
        return self.library.rows("SELECT * FROM documents WHERE deleted_at IS NULL AND id!=? AND (?='' OR instr(lower(coalesce(title,'')),?)>0 OR instr(lower(original_name),?)>0 OR instr(lower(authors_json),?)>0 OR CAST(year AS TEXT)=? OR EXISTS(SELECT 1 FROM document_tags t WHERE t.document_id=documents.id AND instr(t.tag_key,?)>0)) ORDER BY created_at DESC,id DESC LIMIT 20",(document_id,text,text,text,text,text,text))

    def candidates(self, kind, identity, query='', allowed=None):
        with self.db.lock:return self._candidates(kind,identity,query,allowed)

    def _candidates(self, kind, identity, query='', allowed=None):
        """Bounded keyword retrieval over titles, tags, abstracts and saved text.

        Semantic retrieval remains opt-in in Search; this deterministic fallback never
        sends documents to an embedding provider or manufactures a nonempty result.
        """
        source = self.entity(kind, identity)
        def text(k, row):
            parts = [row.get('title') or row.get('original_name') or '']
            if k == 'document':
                parts += [row.get('summary_md') or '']
                parts += [r['tag'] for r in self.library.rows('SELECT tag FROM document_tags WHERE document_id=?', (row['id'],))]
                parts += [r['text'] for r in self.library.rows('SELECT substr(text,1,3000) AS text FROM document_blocks WHERE document_id=? AND extraction_version=? ORDER BY ordinal LIMIT 4', (row['id'], row['extraction_version']))]
            else:
                parts += [r['body_md'] for r in self.library.rows('SELECT substr(r.body_md,1,5000) AS body_md FROM topic_notebooks n JOIN topics h ON h.id=n.id JOIN revisions r ON r.id=h.current_revision_id WHERE n.topic_id=? AND n.deleted_at IS NULL LIMIT 4', (row['id'],))]
            return '\n'.join(parts)[:18000]
        def terms(value):
            words = re.findall(r'[a-z0-9_]{3,}|[\u4e00-\u9fff]{2,8}', value.lower())
            return set(words) - {'the', 'and', 'with', 'from', 'this', 'that', '研究', '文献', '专题'}
        source_text = query.strip() or text(kind, source)
        tokens = terms(source_text)
        def body_matches(k,row):
            # Search all current blocks/notes, not just the bounded display excerpt.
            # One SQLite query per entity avoids loading entire papers into Python.
            import json
            values=json.dumps(sorted(tokens)[:64])
            if k=='document':
                hits=self.library.rows("SELECT term.value AS term,b.id AS block_id,b.physical_page,substr(b.text,max(1,instr(lower(b.text),term.value)-80),300) AS snippet FROM json_each(?) term JOIN document_blocks b ON b.document_id=? AND b.extraction_version=? WHERE instr(lower(b.text),term.value)>0 GROUP BY term.value LIMIT 12",(values,row['id'],row['extraction_version']))
            else:
                hits=self.library.rows("SELECT term.value AS term,n.id AS note_id,substr(r.body_md,max(1,instr(lower(r.body_md),term.value)-80),300) AS snippet FROM json_each(?) term JOIN topic_notebooks n ON n.topic_id=? AND n.deleted_at IS NULL JOIN topics h ON h.id=n.id AND h.deleted_at IS NULL JOIN revisions r ON r.id=h.current_revision_id WHERE instr(lower(r.body_md),term.value)>0 GROUP BY term.value LIMIT 12",(values,row['id']))
            return hits
        enabled=bool(self.library.rows('SELECT semantic_enabled FROM ai_preferences WHERE singleton=1')[0]['semantic_enabled'])
        # Reuse only active, configuration-matched local vectors. Candidate lookup
        # never silently builds a paid index or asks main for credentials.
        def vector(row):
            import json
            import numpy as np
            config=self.library.rows("SELECT kind,base_url,model,version FROM provider_configs WHERE kind='embedding'")
            generation=self.library.rows('SELECT * FROM index_generations WHERE id=? AND complete=1 AND extraction_version=?',(row.get('active_index_generation'),row['extraction_version']))
            if not config or not generation or json.loads(generation[0]['config_json'])!=config[0]:return None
            values=self.library.rows('SELECT vector FROM embeddings WHERE generation_id=? LIMIT 80',(generation[0]['id'],))
            if not values:return None
            arrays=[np.frombuffer(r['vector'],dtype='<f4') for r in values]
            if any(len(a)!=generation[0]['dimension'] or not np.isfinite(a).all() for a in arrays):return None
            mean=np.mean(arrays,axis=0);norm=np.linalg.norm(mean)
            return mean/norm if norm else None
        source_vector=vector(source) if enabled and kind=='document' and not query.strip() else None
        items = []
        for other_kind, table in [('document', 'documents'), ('topic', 'topics')]:
            rows = self.library.rows(f'SELECT * FROM {table} WHERE deleted_at IS NULL' + (' AND notebook_only=0' if other_kind == 'topic' else '') + ' ORDER BY updated_at DESC,id LIMIT 300')
            for row in rows:
                if other_kind == kind and row['id'] == identity: continue
                if allowed is not None and row['id'] not in allowed.get(other_kind, set()): continue
                support=body_matches(other_kind,row)
                overlap = sorted((tokens & terms(text(other_kind, row)))|{hit['term'] for hit in support})
                semantic_score=0.
                if source_vector is not None and other_kind=='document':
                    import numpy as np
                    other_vector=vector(row)
                    if other_vector is not None and len(source_vector)==len(other_vector):semantic_score=float(np.dot(source_vector,other_vector))
                if (not overlap and semantic_score<0.55) or self.state(kind, identity, other_kind, row['id']): continue
                items.append({'kind': other_kind, 'id': row['id'], 'title': row.get('title') or row.get('original_name'),
                              'version': row['version'], 'reason': ('共同内容词：' + '、'.join(overlap[:6])) if overlap else '已建本地索引中的语义接近，需核对内容',
                              'score': len(overlap)+max(0,semantic_score), 'source': {'kind': kind, 'id': identity, 'version': source['version']},
                              'excerpt': support[0]['snippet'] if support else text(other_kind, row)[:300],
                              'support':support[:3]})
        return {'items': sorted(items, key=lambda r: (-r['score'], r['id']))[:20], 'mode': 'keyword+cached_semantic' if source_vector is not None else 'keyword',
                'semantic_fallback': 'NO_MATCHING_LOCAL_INDEX' if enabled and source_vector is None else None}

    def topics(self, identity):
        self.entity('topic', identity)
        rows = self.library.rows('SELECT r.*,t.id,t.title,t.version FROM topic_relations r JOIN topics t ON t.id=CASE WHEN r.low_id=? THEN r.high_id ELSE r.low_id END WHERE (r.low_id=? OR r.high_id=?) AND t.deleted_at IS NULL AND t.notebook_only=0 ORDER BY r.updated_at DESC', (identity, identity, identity))
        return {'items': rows}
