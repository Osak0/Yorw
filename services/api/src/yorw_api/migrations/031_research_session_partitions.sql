ALTER TABLE research_sessions ADD COLUMN partition_name TEXT NOT NULL DEFAULT '';
CREATE INDEX research_sessions_partition ON research_sessions(partition_name, updated_at);
