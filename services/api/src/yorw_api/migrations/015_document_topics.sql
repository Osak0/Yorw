-- Stage B step 10: explicit many-to-many document/topic links. Notes stay in
-- their document row and are exposed through these links without copying.
CREATE TABLE document_topics (
    document_id TEXT NOT NULL REFERENCES documents(id),
    topic_id TEXT NOT NULL REFERENCES topics(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY(document_id, topic_id)
);
CREATE INDEX document_topics_topic ON document_topics(topic_id, document_id);
