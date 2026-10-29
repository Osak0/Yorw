-- v0.3.0 stage 1 step 3: versioned content blocks and parser provenance.
-- Existing PDF chunk IDs are reused as block IDs so old citation snapshots
-- remain resolvable without rewriting immutable history.
ALTER TABLE documents ADD COLUMN format TEXT NOT NULL DEFAULT 'pdf';
ALTER TABLE documents ADD COLUMN media_type TEXT NOT NULL DEFAULT 'application/pdf';
ALTER TABLE documents ADD COLUMN parser_name TEXT;
ALTER TABLE documents ADD COLUMN parser_version TEXT;
ALTER TABLE documents ADD COLUMN parser_config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE documents ADD COLUMN parse_warnings_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE documents ADD COLUMN parse_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN parse_status TEXT;
ALTER TABLE documents ADD COLUMN parse_warning TEXT;
ALTER TABLE documents ADD COLUMN parse_updated_at TEXT;

UPDATE documents SET parse_version=extraction_version,
    parse_status=extraction_status,
    parse_warning=warning,
    parse_updated_at=updated_at;

CREATE TABLE document_blocks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    extraction_version INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    block_type TEXT NOT NULL,
    text TEXT NOT NULL,
    section_path_json TEXT NOT NULL DEFAULT '[]',
    physical_page INTEGER,
    location_json TEXT NOT NULL DEFAULT '{}',
    heading_level INTEGER,
    UNIQUE(document_id, extraction_version, ordinal)
);
CREATE INDEX document_blocks_document ON document_blocks(document_id, extraction_version, ordinal);
CREATE INDEX document_blocks_page ON document_blocks(document_id, physical_page);

INSERT INTO document_blocks(id, document_id, extraction_version, ordinal, block_type,
                            text, section_path_json, physical_page, location_json, heading_level)
SELECT id, document_id, extraction_version, ordinal, 'page', text, '[]', physical_page,
       '{"kind":"page","physical_page":' || physical_page || ',"block_ordinal":' || ordinal || '}', NULL
FROM chunks;
