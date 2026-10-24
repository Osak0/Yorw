CREATE TABLE wiki_decisions (
    request_id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id),
    suggestion_id TEXT UNIQUE REFERENCES suggestions(id),
    action TEXT NOT NULL CHECK (action IN ('accept','reject','restore')),
    revision_id TEXT REFERENCES revisions(id),
    request_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TRIGGER wiki_decisions_immutable_update BEFORE UPDATE ON wiki_decisions BEGIN
    SELECT RAISE(ABORT,'DECISION_IMMUTABLE');
END;
CREATE TRIGGER wiki_decisions_immutable_delete BEFORE DELETE ON wiki_decisions BEGIN
    SELECT RAISE(ABORT,'DECISION_IMMUTABLE');
END;
