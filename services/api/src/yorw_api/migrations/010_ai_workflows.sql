CREATE TABLE ai_preferences (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 semantic_enabled INTEGER NOT NULL DEFAULT 1 CHECK(semantic_enabled IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO ai_preferences(singleton) VALUES(1);
CREATE TABLE knowledge_sources (
 source_key TEXT PRIMARY KEY,
 version TEXT NOT NULL,
 kind TEXT NOT NULL,
 object_id TEXT NOT NULL,
 title TEXT NOT NULL
);
CREATE TABLE knowledge_segments (
 id TEXT PRIMARY KEY,
 source_key TEXT NOT NULL REFERENCES knowledge_sources(source_key) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL,
 text TEXT NOT NULL,
 source_json TEXT NOT NULL
);
CREATE INDEX knowledge_segments_source ON knowledge_segments(source_key);
CREATE VIRTUAL TABLE knowledge_fts USING fts5(id UNINDEXED,tokens,tokenize='unicode61');
CREATE TRIGGER knowledge_segment_delete AFTER DELETE ON knowledge_segments BEGIN
 DELETE FROM knowledge_fts WHERE id=old.id;
END;
CREATE TABLE knowledge_vectors (
 segment_id TEXT NOT NULL REFERENCES knowledge_segments(id) ON DELETE CASCADE,
 config_hash TEXT NOT NULL,
 dimension INTEGER NOT NULL,
 vector BLOB NOT NULL,
 PRIMARY KEY(segment_id,config_hash)
);
CREATE TABLE ai_requests (
 request_id TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 target_id TEXT NOT NULL,
 input_json TEXT NOT NULL,
 task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id)
);
ALTER TABLE messages ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX messages_request ON messages(conversation_id,request_id) WHERE request_id IS NOT NULL;
