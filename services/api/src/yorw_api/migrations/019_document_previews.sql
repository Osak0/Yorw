CREATE TABLE document_previews (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id),
 cache_key TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
 pages_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
 UNIQUE(document_id,cache_key)
);
CREATE TABLE preview_locations (
 preview_id TEXT NOT NULL REFERENCES document_previews(id) ON DELETE CASCADE,
 block_id TEXT NOT NULL, extraction_version INTEGER NOT NULL,
 ranges_json TEXT NOT NULL, PRIMARY KEY(preview_id,block_id)
);
