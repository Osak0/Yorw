"""Replaceable derived indexes; adapters never own original text or scope."""
from typing import Protocol

import numpy as np


class LexicalRetriever(Protocol):
    def query(self, terms: list[str], allowed: set[str]) -> list[str]: ...


class SQLiteLexicalRetriever:
    def __init__(self, library): self.library = library

    def query(self, terms, allowed):
        expression = ' OR '.join('"'+word.replace('"','""')+'"' for word in terms)
        rows = self.library.rows('SELECT id,bm25(knowledge_fts) AS score FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY score,id',(expression,)) if expression else []
        return [r['id'] for r in rows if r['id'] in allowed]


class VectorIndex(Protocol):
    def load(self, config_hash: str, allowed: set[str]) -> dict: ...
    def write(self, conn, identity, config_hash, vector): ...
    def query(self, vectors, query, allowed, limit=40) -> list[str]: ...
    def delete(self, conn, identities): ...
    def rebuild(self, conn, config_hash): ...
    def current(self, identity, config_hash): ...


class SQLiteNumpyVectorIndex:
    def __init__(self, library): self.library = library

    def load(self, config_hash, allowed):
        return {r['segment_id']:np.frombuffer(r['vector'],dtype='<f4') for r in self.library.rows('SELECT * FROM knowledge_vectors WHERE config_hash=?',(config_hash,)) if r['segment_id'] in allowed}

    def write(self, conn, identity, config_hash, vector):
        conn.execute('INSERT OR REPLACE INTO knowledge_vectors VALUES(?,?,?,?)',(identity,config_hash,len(vector),vector.tobytes()))

    def query(self, vectors, query, allowed, limit=40):
        return sorted((i for i in allowed if i in vectors and len(vectors[i])==len(query)),key=lambda i:(-float(np.dot(vectors[i],query)),i))[:limit]

    def delete(self, conn, identities):
        conn.executemany('DELETE FROM knowledge_vectors WHERE segment_id=?',[(i,) for i in identities])

    def rebuild(self, conn, config_hash):
        conn.execute('DELETE FROM knowledge_vectors WHERE config_hash=?',(config_hash,))

    def current(self, identity, config_hash):
        return bool(self.library.rows('SELECT 1 FROM knowledge_vectors v JOIN knowledge_segments s ON s.id=v.segment_id WHERE v.segment_id=? AND v.config_hash=?',(identity,config_hash)))
