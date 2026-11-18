-- SQLite is authoritative; History.md is a derived, rebuildable view.
CREATE TABLE document_chat_memory (
 document_id TEXT PRIMARY KEY REFERENCES documents(id),
 extraction_version INTEGER NOT NULL,
 summary_md TEXT NOT NULL DEFAULT '',
 covered_ids_json TEXT NOT NULL DEFAULT '[]',
 compression_mode TEXT NOT NULL DEFAULT 'local',
 updated_at TEXT NOT NULL
);
