ALTER TABLE topics ADD COLUMN deleted_at TEXT;
CREATE INDEX topics_available ON topics(deleted_at,parent_id);
