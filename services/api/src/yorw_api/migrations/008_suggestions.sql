CREATE TABLE suggestions (
 id TEXT PRIMARY KEY,
 topic_id TEXT NOT NULL REFERENCES topics(id),
 base_revision_id TEXT NOT NULL REFERENCES revisions(id),
 base_body_md TEXT NOT NULL,
 instruction TEXT NOT NULL,
 body_md TEXT NOT NULL DEFAULT '',
 sources_json TEXT NOT NULL,
 materials_json TEXT NOT NULL,
 request_json TEXT NOT NULL,
 provider_snapshot_json TEXT NOT NULL,
 prompt_version TEXT NOT NULL,
 status TEXT NOT NULL,
 error_code TEXT,
 request_id TEXT NOT NULL UNIQUE,
 task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
 created_at TEXT NOT NULL
);
CREATE INDEX suggestions_topic ON suggestions(topic_id,created_at);
