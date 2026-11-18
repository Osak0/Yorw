CREATE TABLE research_sessions (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, scope_json TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
 deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE research_tasks (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES research_sessions(id),
 request_id TEXT NOT NULL UNIQUE, request_json TEXT NOT NULL,
 question TEXT NOT NULL, body_md TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
 error_code TEXT, scope_json TEXT NOT NULL, scope_version INTEGER NOT NULL,
 profile_json TEXT NOT NULL, sources_json TEXT NOT NULL DEFAULT '[]',
 usage_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE research_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES research_sessions(id),
 task_id TEXT REFERENCES research_tasks(id), kind TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX research_tasks_session ON research_tasks(session_id,created_at,id);
CREATE INDEX research_events_session ON research_events(session_id,sequence);
