-- Stage B step 8: immutable submitted-query snapshots for the document
-- resource view. Deleting a history row never deletes tasks, notes or chat.
CREATE TABLE search_history (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    request_id TEXT NOT NULL UNIQUE,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    query TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    results_json TEXT NOT NULL DEFAULT '[]',
    reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX search_history_document ON search_history(document_id, created_at DESC, id);
