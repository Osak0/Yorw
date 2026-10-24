CREATE TABLE conversations (
 id TEXT PRIMARY KEY,
 document_id TEXT NOT NULL UNIQUE REFERENCES documents(id),
 created_at TEXT NOT NULL
);
CREATE TABLE messages (
 id TEXT PRIMARY KEY,
 conversation_id TEXT NOT NULL REFERENCES conversations(id),
 question TEXT NOT NULL,
 body_md TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL,
 error_code TEXT,
 sources_json TEXT NOT NULL,
 provider_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 note_id TEXT REFERENCES notes(id)
);
CREATE INDEX messages_conversation ON messages(conversation_id,created_at);
