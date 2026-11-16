-- Notebook identities reuse the append-only Wiki revision/decision engine.
-- notebook_only rows are revision heads, never visible topic-tree nodes.
ALTER TABLE topics ADD COLUMN notebook_only INTEGER NOT NULL DEFAULT 0 CHECK(notebook_only IN (0,1));
CREATE TABLE topic_notebooks (
 id TEXT PRIMARY KEY REFERENCES topics(id),topic_id TEXT NOT NULL REFERENCES topics(id),
 title TEXT,deleted_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX topic_notebooks_owner ON topic_notebooks(topic_id,deleted_at);
CREATE TABLE topic_note_scope (
 topic_id TEXT NOT NULL REFERENCES topics(id),source_topic_id TEXT NOT NULL REFERENCES topics(id),
 selected INTEGER NOT NULL CHECK(selected IN (0,1)),PRIMARY KEY(topic_id,source_topic_id)
);
INSERT INTO topic_note_scope SELECT id,id,1 FROM topics WHERE deleted_at IS NULL;
INSERT INTO topic_notebooks(id,topic_id,created_at,updated_at)
 SELECT t.id,t.id,t.created_at,t.updated_at FROM topics t
 WHERE t.deleted_at IS NULL AND (
 EXISTS(SELECT 1 FROM revisions r WHERE r.topic_id=t.id AND (length(trim(r.body_md))>0 OR r.ordinal>1))
 OR EXISTS(SELECT 1 FROM suggestions s WHERE s.topic_id=t.id));
CREATE TRIGGER notebook_legacy_body AFTER UPDATE OF current_revision_id ON topics
 WHEN NEW.notebook_only=0 AND NEW.deleted_at IS NULL AND EXISTS(SELECT 1 FROM revisions WHERE id=NEW.current_revision_id AND (length(trim(body_md))>0 OR ordinal>1)) BEGIN
 INSERT OR IGNORE INTO topic_notebooks(id,topic_id,created_at,updated_at) VALUES(NEW.id,NEW.id,NEW.created_at,NEW.updated_at);
END;
CREATE TRIGGER notebook_legacy_suggestion AFTER INSERT ON suggestions BEGIN
 INSERT OR IGNORE INTO topic_notebooks(id,topic_id,created_at,updated_at) SELECT id,id,created_at,updated_at FROM topics WHERE id=NEW.topic_id AND notebook_only=0;
END;
CREATE TRIGGER notebook_activity AFTER UPDATE OF current_revision_id ON topics WHEN NEW.notebook_only=1 BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,topic_id,summary,payload_json,created_at)
 SELECT 'notebook:'||NEW.current_revision_id,'topic',NEW.id,NEW.current_revision_id,n.topic_id,'保存专题笔记：'||NEW.title,json_object('text',substr(r.body_md,1,2000)),NEW.updated_at FROM topic_notebooks n JOIN revisions r ON r.id=NEW.current_revision_id WHERE n.id=NEW.id AND n.deleted_at IS NULL;
END;

CREATE TRIGGER notebook_owner_created AFTER INSERT ON topic_notebooks WHEN NEW.id<>NEW.topic_id BEGIN
 UPDATE topics SET version=version+1,updated_at=NEW.updated_at WHERE id=NEW.topic_id;
END;
CREATE TRIGGER notebook_owner_changed AFTER UPDATE ON topic_notebooks BEGIN
 UPDATE topics SET version=version+1,updated_at=NEW.updated_at WHERE id IN (OLD.topic_id,NEW.topic_id);
END;
CREATE TRIGGER notebook_owner_body AFTER UPDATE OF current_revision_id ON topics WHEN NEW.notebook_only=1 BEGIN
 UPDATE topics SET version=version+1,updated_at=NEW.updated_at WHERE id IN (SELECT topic_id FROM topic_notebooks WHERE id=NEW.id AND deleted_at IS NULL) AND id<>NEW.id;
END;

-- Reading notes keep their original IDs and gain immutable version snapshots.
CREATE TABLE reading_note_revisions (
 note_id TEXT NOT NULL REFERENCES notes(id),version INTEGER NOT NULL,
 body_md TEXT NOT NULL,sources_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(note_id,version)
);
INSERT INTO reading_note_revisions SELECT id,version,body_md,sources_json,updated_at FROM notes;
CREATE TRIGGER reading_snapshot_insert AFTER INSERT ON notes BEGIN
 INSERT INTO reading_note_revisions VALUES(NEW.id,NEW.version,NEW.body_md,NEW.sources_json,NEW.updated_at);
END;
CREATE TRIGGER reading_snapshot_update AFTER UPDATE OF version ON notes WHEN NEW.version<>OLD.version BEGIN
 INSERT INTO reading_note_revisions VALUES(NEW.id,NEW.version,NEW.body_md,NEW.sources_json,NEW.updated_at);
END;
CREATE TRIGGER reading_snapshot_immutable_update BEFORE UPDATE ON reading_note_revisions BEGIN SELECT RAISE(ABORT,'REVISION_IMMUTABLE'); END;
CREATE TRIGGER reading_snapshot_immutable_delete BEFORE DELETE ON reading_note_revisions BEGIN SELECT RAISE(ABORT,'REVISION_IMMUTABLE'); END;
-- Private suggestion heads adapt reading notes to the existing explicit AI review engine.
CREATE TABLE reading_note_heads (
 head_id TEXT PRIMARY KEY REFERENCES topics(id),note_id TEXT NOT NULL UNIQUE REFERENCES notes(id),
 base_note_version INTEGER NOT NULL
);
