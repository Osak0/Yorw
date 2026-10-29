-- AI-derived metadata is separate from human-owned document fields.
CREATE TABLE enrichment_preferences (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 enabled_at TEXT,
 version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO enrichment_preferences(singleton) VALUES(1);
CREATE TABLE document_enrichments (
 id INTEGER PRIMARY KEY,
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 extraction_version INTEGER NOT NULL,
 config_hash TEXT NOT NULL,
 prompt_version TEXT NOT NULL,
 result_json TEXT NOT NULL,
 coverage_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1))
);
CREATE INDEX enrichment_document ON document_enrichments(document_id,id DESC);
CREATE TABLE enrichment_decisions (
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 extraction_version INTEGER NOT NULL,
 decision_key TEXT NOT NULL,
 PRIMARY KEY(document_id,extraction_version,decision_key)
);
CREATE TABLE enrichment_requests (
 fingerprint TEXT PRIMARY KEY,
 task_id TEXT NOT NULL REFERENCES tasks(id)
);

ALTER TABLE ai_preferences ADD COLUMN metadata_enabled INTEGER NOT NULL DEFAULT 0 CHECK(metadata_enabled IN (0,1));
CREATE TABLE document_hint_index (
 document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
 fingerprint TEXT NOT NULL
);
CREATE VIRTUAL TABLE document_hint_fts USING fts5(document_id UNINDEXED,tokens,tokenize='unicode61');
CREATE TRIGGER document_hint_delete AFTER DELETE ON document_hint_index BEGIN
 DELETE FROM document_hint_fts WHERE document_id=old.document_id;
END;
