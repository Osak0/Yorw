CREATE TABLE topics (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES topics(id),
    title TEXT NOT NULL,
    current_revision_id TEXT REFERENCES revisions(id),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (parent_id IS NULL OR parent_id != id)
);
CREATE TABLE revisions (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id),
    ordinal INTEGER NOT NULL CHECK (ordinal > 0),
    body_md TEXT NOT NULL,
    sources_json TEXT NOT NULL DEFAULT '[]',
    origin TEXT NOT NULL,
    base_revision_id TEXT REFERENCES revisions(id),
    restored_from_id TEXT REFERENCES revisions(id),
    created_at TEXT NOT NULL,
    UNIQUE(topic_id,ordinal)
);
CREATE INDEX topics_parent ON topics(parent_id);
CREATE TRIGGER revisions_immutable_update BEFORE UPDATE ON revisions BEGIN
    SELECT RAISE(ABORT,'REVISION_IMMUTABLE');
END;
CREATE TRIGGER revisions_immutable_delete BEFORE DELETE ON revisions BEGIN
    SELECT RAISE(ABORT,'REVISION_IMMUTABLE');
END;
