CREATE TABLE search_documents (
    document_id TEXT PRIMARY KEY REFERENCES documents(id),
    extraction_version INTEGER NOT NULL,
    chunk_version TEXT NOT NULL
);
CREATE TABLE search_segments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    extraction_version INTEGER NOT NULL,
    chunk_version TEXT NOT NULL,
    physical_page INTEGER NOT NULL,
    start_offset INTEGER NOT NULL,
    end_offset INTEGER NOT NULL,
    text TEXT NOT NULL,
    tokens TEXT NOT NULL
);
CREATE INDEX search_segments_document ON search_segments(document_id);
CREATE VIRTUAL TABLE chunks_fts USING fts5(segment_id UNINDEXED, document_id UNINDEXED, tokens, tokenize='unicode61');
CREATE TRIGGER search_segment_insert AFTER INSERT ON search_segments BEGIN
    INSERT INTO chunks_fts(segment_id,document_id,tokens) VALUES(new.id,new.document_id,new.tokens);
END;
CREATE TRIGGER search_segment_delete AFTER DELETE ON search_segments BEGIN
    DELETE FROM chunks_fts WHERE segment_id=old.id;
END;
CREATE TABLE index_generations (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    extraction_version INTEGER NOT NULL,
    chunk_version TEXT NOT NULL,
    config_fingerprint TEXT NOT NULL,
    config_json TEXT NOT NULL,
    dimension INTEGER,
    complete INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX index_generations_document ON index_generations(document_id);
CREATE TABLE embeddings (
    segment_id TEXT NOT NULL REFERENCES search_segments(id) ON DELETE CASCADE,
    generation_id TEXT NOT NULL REFERENCES index_generations(id) ON DELETE CASCADE,
    vector BLOB NOT NULL,
    PRIMARY KEY(segment_id,generation_id)
);
