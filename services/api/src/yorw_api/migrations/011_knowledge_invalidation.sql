-- Invalidate derived indexes immediately; immutable research records are kept.
CREATE TRIGGER knowledge_document_invalidate
AFTER UPDATE OF deleted_at,extraction_version,title,original_name ON documents
WHEN new.deleted_at IS NOT old.deleted_at OR new.extraction_version!=old.extraction_version
 OR new.title IS NOT old.title OR new.original_name!=old.original_name
BEGIN
 DELETE FROM knowledge_sources WHERE source_key IN (
  SELECT source_key FROM knowledge_segments WHERE instr(source_json,new.id)>0
 );
END;
CREATE TRIGGER knowledge_note_invalidate AFTER UPDATE OF version ON notes
WHEN new.version!=old.version BEGIN
 DELETE FROM knowledge_sources WHERE kind='note' AND object_id=new.id;
END;
CREATE TRIGGER knowledge_note_remove AFTER DELETE ON notes BEGIN
 DELETE FROM knowledge_sources WHERE kind='note' AND object_id=old.id;
END;
CREATE TRIGGER knowledge_wiki_invalidate AFTER UPDATE OF current_revision_id ON topics
WHEN new.current_revision_id IS NOT old.current_revision_id BEGIN
 DELETE FROM knowledge_sources WHERE kind='wiki' AND object_id=new.id;
END;
