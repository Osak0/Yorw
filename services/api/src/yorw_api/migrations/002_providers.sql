CREATE TABLE provider_configs (
    kind TEXT PRIMARY KEY CHECK (kind IN ('chat', 'embedding')),
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    options_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);
