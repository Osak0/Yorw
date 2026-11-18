CREATE TABLE research_activity (
 id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL,object_id TEXT NOT NULL,object_version TEXT NOT NULL,
 document_id TEXT,topic_id TEXT,summary TEXT NOT NULL,payload_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL
);
CREATE TABLE research_memory_state (
 scope_key TEXT PRIMARY KEY,user_guide TEXT NOT NULL DEFAULT '',content_version INTEGER NOT NULL DEFAULT 1,
 summary_version INTEGER NOT NULL DEFAULT 0,covered_event INTEGER NOT NULL DEFAULT 0,
 last_attempt REAL NOT NULL DEFAULT 0,mode TEXT NOT NULL DEFAULT 'local',updated_at TEXT NOT NULL
);
INSERT INTO research_memory_state(scope_key,updated_at) VALUES('global',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE research_memory_entries (
 id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,text_md TEXT NOT NULL,certainty TEXT NOT NULL,
 event_ids_json TEXT NOT NULL DEFAULT '[]',source_refs_json TEXT NOT NULL DEFAULT '[]',task_json TEXT NOT NULL DEFAULT '{}',
 pinned INTEGER NOT NULL DEFAULT 0,forgotten INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL
);
CREATE INDEX memory_entries_scope ON research_memory_entries(scope_key,forgotten);
CREATE TABLE research_memory_exclusions (
 object_kind TEXT NOT NULL,object_id TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(object_kind,object_id)
);
CREATE TABLE research_memory_versions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,scope_key TEXT NOT NULL,content_version INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE research_memory_preferences (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),enabled INTEGER NOT NULL DEFAULT 1,
 daily_limit INTEGER NOT NULL DEFAULT 20,cooldown_seconds INTEGER NOT NULL DEFAULT 600,
 turn_threshold INTEGER NOT NULL DEFAULT 6,event_threshold INTEGER NOT NULL DEFAULT 20,
 input_limit INTEGER NOT NULL DEFAULT 24000,version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO research_memory_preferences(singleton) VALUES(1);
CREATE TABLE research_memory_usage(day TEXT PRIMARY KEY,calls INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER activity_document_import AFTER INSERT ON documents BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at) VALUES('document_import:'||NEW.id||':'||CAST(NEW.extraction_version AS TEXT),'document',NEW.id,CAST(NEW.extraction_version AS TEXT),NEW.id,NULL,'导入文献：'||NEW.original_name,json_object('title',NEW.title,'name',NEW.original_name),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_document_parse AFTER UPDATE ON documents WHEN NEW.extraction_version<>OLD.extraction_version OR (NEW.extraction_status<>OLD.extraction_status AND NEW.extraction_status IN ('ready','partial')) BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at) VALUES('document_parse:'||NEW.id||':'||CAST(NEW.extraction_version AS TEXT),'document',NEW.id,CAST(NEW.extraction_version AS TEXT),NEW.id,NULL,'原文解析更新：'||NEW.original_name,json_object('status',NEW.extraction_status),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_document_delete AFTER UPDATE ON documents WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at) VALUES('document_delete:'||NEW.id||':'||CAST(NEW.version AS TEXT),'document_deleted',NEW.id,CAST(NEW.version AS TEXT),NEW.id,NULL,'移除文献：'||NEW.original_name,'{}',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_note_create AFTER INSERT ON notes BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at) VALUES('note_create:'||NEW.id||':'||CAST(NEW.version AS TEXT),'note',NEW.id,CAST(NEW.version AS TEXT),NEW.document_id,NULL,'保存阅读笔记',json_object('text',substr(NEW.body_md,1,2000)),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_note_update AFTER UPDATE ON notes WHEN NEW.version<>OLD.version BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at) VALUES('note_update:'||NEW.id||':'||CAST(NEW.version AS TEXT),'note',NEW.id,CAST(NEW.version AS TEXT),NEW.document_id,NULL,'更新阅读笔记',json_object('text',substr(NEW.body_md,1,2000)),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_document_chat AFTER UPDATE ON messages WHEN NEW.status<>OLD.status AND NEW.status IN ('completed','failed','cancelled','interrupted') BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at) VALUES('document_chat:'||NEW.id||':'||NEW.status,'message',NEW.id,NEW.status,(SELECT document_id FROM conversations WHERE id=NEW.conversation_id),NULL,'文献问答：'||substr(NEW.question,1,160),json_object('question',NEW.question,'answer',substr(NEW.body_md,1,2400),'sources',json(NEW.sources_json)),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_research_chat AFTER UPDATE ON research_tasks WHEN NEW.status<>OLD.status AND NEW.status IN ('completed','failed','cancelled','interrupted','context_changed') BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at) VALUES('research_chat:'||NEW.id||':'||NEW.status,'research',NEW.id,NEW.status,NULL,json_extract(NEW.scope_json,'$.topic_id'),'研究讨论：'||substr(NEW.question,1,160),json_object('question',NEW.question,'answer',substr(NEW.body_md,1,2400),'sources',json(NEW.sources_json),'session_id',NEW.session_id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_topic_revision AFTER INSERT ON revisions BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at) VALUES('topic_revision:'||NEW.topic_id||':'||NEW.id,'topic',NEW.topic_id,NEW.id,NULL,NEW.topic_id,'专题修订',json_object('text',substr(NEW.body_md,1,2000),'origin',NEW.origin),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_wiki_decision AFTER INSERT ON wiki_decisions BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at) VALUES('wiki_decision:'||NEW.request_id||':'||NEW.action,'decision',NEW.request_id,NEW.action,NULL,NEW.topic_id,'专题建议：'||NEW.action,json_object('revision_id',NEW.revision_id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_metadata_apply AFTER INSERT ON enrichment_applications BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at) VALUES('metadata_apply:'||CAST(NEW.id AS TEXT)||':'||CAST(NEW.enrichment_id AS TEXT),'application',CAST(NEW.id AS TEXT),CAST(NEW.enrichment_id AS TEXT),NEW.document_id,NULL,'采纳文献整理建议',json_object('fields',json(NEW.fields_json)),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_document_link AFTER INSERT ON document_topics BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at) VALUES('document_link:'||NEW.document_id||':'||NEW.topic_id||':'||NEW.created_at,'link',NEW.document_id||':'||NEW.topic_id,NEW.created_at,NEW.document_id,NEW.topic_id,'建立文献与专题关联','{}',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_document_relation AFTER INSERT ON document_relations BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at) VALUES('document_relation:'||NEW.low_id||':'||NEW.high_id||':'||NEW.created_at,'relation',NEW.low_id||':'||NEW.high_id,NEW.created_at,NEW.low_id,NULL,'建立文献关系',json_object('related_document_id',NEW.high_id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER activity_metadata AFTER UPDATE ON documents WHEN NEW.version<>OLD.version AND NEW.deleted_at IS NULL BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,summary,payload_json,created_at) VALUES('metadata:'||NEW.id||':'||NEW.version,'metadata',NEW.id,CAST(NEW.version AS TEXT),NEW.id,'修改文献元数据',json_object('title',NEW.title),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_topic_tree AFTER UPDATE ON topics WHEN NEW.parent_id IS NOT OLD.parent_id OR NEW.deleted_at IS NOT OLD.deleted_at BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,topic_id,summary,payload_json,created_at) VALUES('topic-tree:'||NEW.id||':'||NEW.version,'topic_tree',NEW.id,CAST(NEW.version AS TEXT),NEW.id,'专题目录变更',json_object('parent_id',NEW.parent_id,'deleted',NEW.deleted_at),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER activity_unlink AFTER DELETE ON document_topics BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,created_at) VALUES('unlink:'||OLD.document_id||':'||OLD.topic_id||':'||strftime('%Y-%m-%dT%H:%M:%fZ','now'),'unlink',OLD.document_id||':'||OLD.topic_id,OLD.created_at,OLD.document_id,OLD.topic_id,'解除文献与专题关联',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,summary,payload_json,created_at)
 SELECT 'snapshot-document:'||id||':'||extraction_version,'document',id,CAST(extraction_version AS TEXT),id,'迁移时现存文献快照：'||original_name,json_object('title',title),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM documents WHERE deleted_at IS NULL;
INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,summary,payload_json,created_at)
 SELECT 'snapshot-note:'||id||':'||version,'note',id,CAST(version AS TEXT),document_id,'迁移时现存笔记快照',json_object('text',substr(body_md,1,2000)),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM notes WHERE length(body_md)>0;
INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,topic_id,summary,payload_json,created_at)
 SELECT 'snapshot-topic:'||r.topic_id||':'||r.id,'topic',r.topic_id,r.id,r.topic_id,'迁移时现存专题修订快照',json_object('text',substr(r.body_md,1,2000)),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM revisions r JOIN topics t ON t.current_revision_id=r.id WHERE t.deleted_at IS NULL;
INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,topic_id,summary,payload_json,created_at)
 SELECT 'snapshot-research:'||t.id||':'||t.status,'research',t.id,t.status,json_extract(t.scope_json,'$.topic_id'),'迁移时研究讨论快照：'||substr(t.question,1,160),json_object('question',t.question,'answer',substr(t.body_md,1,2400),'sources',json(t.sources_json),'session_id',t.session_id),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM research_tasks t JOIN research_sessions s ON s.id=t.session_id WHERE s.deleted_at IS NULL AND t.status<>'running';

CREATE TRIGGER activity_relation_remove AFTER DELETE ON document_relations BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,summary,payload_json,created_at) VALUES('relation-remove:'||OLD.low_id||':'||OLD.high_id||':'||strftime('%Y-%m-%dT%H:%M:%fZ','now'),'relation_removed',OLD.low_id||':'||OLD.high_id,OLD.created_at,OLD.low_id,'解除文献关系',json_object('related_document_id',OLD.high_id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,summary,payload_json,created_at)
 SELECT 'snapshot-message:'||m.id||':'||m.status,'message',m.id,m.status,c.document_id,'迁移时文献问答快照：'||substr(m.question,1,160),json_object('question',m.question,'answer',substr(m.body_md,1,2400),'sources',json(m.sources_json)),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.status IN ('completed','failed','cancelled','interrupted');
