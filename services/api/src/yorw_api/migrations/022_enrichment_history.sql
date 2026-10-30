ALTER TABLE document_enrichments ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE document_enrichments ADD COLUMN provider_json TEXT NOT NULL DEFAULT '{}';
UPDATE document_enrichments SET hidden=1 WHERE EXISTS (SELECT 1 FROM enrichment_decisions d WHERE d.document_id=document_enrichments.document_id AND d.extraction_version=document_enrichments.extraction_version AND d.decision_key='hide');
DELETE FROM enrichment_decisions WHERE decision_key='hide';
CREATE TABLE enrichment_applications (
 id INTEGER PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id),
 enrichment_id INTEGER NOT NULL REFERENCES document_enrichments(id),
 before_json TEXT NOT NULL, after_json TEXT NOT NULL, fields_json TEXT NOT NULL, created_at TEXT NOT NULL
);
