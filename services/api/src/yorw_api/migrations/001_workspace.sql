CREATE TABLE workspace_meta (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    workspace_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
