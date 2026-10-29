CREATE TABLE library_folders (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES library_folders(id), name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
ALTER TABLE documents ADD COLUMN folder_id TEXT REFERENCES library_folders(id);
