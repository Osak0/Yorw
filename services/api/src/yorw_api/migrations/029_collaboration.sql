-- Formal proposals are separate from material records until explicit adoption.
CREATE TABLE topic_relations (
 low_id TEXT NOT NULL REFERENCES topics(id),high_id TEXT NOT NULL REFERENCES topics(id),
 description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(low_id,high_id),CHECK(low_id<high_id)
);
CREATE TABLE collaboration_proposals (
 id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,origin_json TEXT NOT NULL,
 operations_json TEXT NOT NULL,sources_json TEXT NOT NULL,guards_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',version INTEGER NOT NULL DEFAULT 1,
 decision_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE collaboration_decisions (
 request_id TEXT PRIMARY KEY,proposal_id TEXT NOT NULL REFERENCES collaboration_proposals(id),
 action TEXT NOT NULL,payload_json TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TRIGGER activity_topic_relation AFTER INSERT ON topic_relations BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,topic_id,summary,payload_json,created_at)
 VALUES('topic-relation:'||NEW.low_id||':'||NEW.high_id||':'||NEW.created_at,'topic_relation',NEW.low_id||':'||NEW.high_id,NEW.created_at,NEW.low_id,'建立专题关系',json_object('related_topic_id',NEW.high_id),NEW.created_at);
END;
CREATE TRIGGER activity_collaboration AFTER UPDATE OF status ON collaboration_proposals WHEN NEW.status<>OLD.status BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,document_id,topic_id,summary,payload_json,created_at)
 VALUES('proposal:'||NEW.id||':'||NEW.version,'proposal',NEW.id,CAST(NEW.version AS TEXT),json_extract(NEW.origin_json,'$.document_id'),json_extract(NEW.origin_json,'$.topic_id'),'资料方案：'||NEW.status,
 json_object('origin',json(NEW.origin_json),'selected',json_extract(NEW.decision_json,'$.selected'),'objects',json((SELECT json_group_array(json_object('kind',json_extract(value,'$.kind'),'id',json_extract(value,'$.id'),'first_kind',json_extract(value,'$.first_kind'),'first',json_extract(value,'$.first'),'second_kind',json_extract(value,'$.second_kind'),'second',json_extract(value,'$.second'))) FROM json_each(NEW.decision_json,'$.records')))),NEW.updated_at);
END;
CREATE TRIGGER activity_topic_relation_remove AFTER DELETE ON topic_relations BEGIN
 INSERT OR IGNORE INTO research_activity(event_key,kind,object_id,object_version,topic_id,summary,payload_json,created_at)
 VALUES('topic-relation-remove:'||OLD.low_id||':'||OLD.high_id||':'||strftime('%Y-%m-%dT%H:%M:%fZ','now'),'topic_relation_removed',OLD.low_id||':'||OLD.high_id,OLD.updated_at,OLD.low_id,'解除专题关系',json_object('related_topic_id',OLD.high_id),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
