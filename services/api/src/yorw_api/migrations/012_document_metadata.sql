-- Stage B step 7: manual summary and normalized document tags. Document rows
-- remain the stable identity; removing a document keeps its metadata rows.
ALTER TABLE documents ADD COLUMN summary_md TEXT;
ALTER TABLE documents ADD COLUMN summary_source TEXT;
ALTER TABLE documents ADD COLUMN summary_updated_at TEXT;

CREATE TABLE document_tags (
    document_id TEXT NOT NULL REFERENCES documents(id),
    tag_key TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(document_id, tag_key)
);
CREATE INDEX document_tags_lookup ON document_tags(tag_key, document_id);
