-- Stage B step 9: one canonical row per unordered document pair. The pair is
-- bidirectional by construction; a description is shared by both sides.
CREATE TABLE document_relations (
    low_id TEXT NOT NULL REFERENCES documents(id),
    high_id TEXT NOT NULL REFERENCES documents(id),
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK(low_id < high_id),
    PRIMARY KEY(low_id, high_id)
);
CREATE INDEX document_relations_high ON document_relations(high_id, low_id);
