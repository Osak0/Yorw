CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    relative_path TEXT,
    original_name TEXT NOT NULL,
    title TEXT,
    authors_json TEXT NOT NULL DEFAULT '[]',
    year INTEGER,
    metadata_source_json TEXT NOT NULL DEFAULT '{}',
    page_count INTEGER,
    extraction_status TEXT NOT NULL,
    extraction_version INTEGER NOT NULL DEFAULT 1,
    active_index_generation TEXT,
    last_page INTEGER NOT NULL DEFAULT 1,
    version INTEGER NOT NULL DEFAULT 1,
    warning TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE TABLE chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    extraction_version INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    physical_page INTEGER NOT NULL CHECK (physical_page > 0),
    text TEXT NOT NULL,
    UNIQUE(document_id, extraction_version, ordinal)
);
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    target_id TEXT,
    status TEXT NOT NULL,
    stage TEXT NOT NULL,
    progress REAL,
    input_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT,
    error_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX tasks_target ON tasks(target_id);
