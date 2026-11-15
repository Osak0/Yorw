CREATE TABLE model_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    version INTEGER NOT NULL CHECK(version > 0),
    legacy_version INTEGER,
    chat_check TEXT,
    tools_check TEXT,
    updated_at TEXT NOT NULL
);
INSERT INTO model_profiles(id,name,provider,base_url,model,version,legacy_version,updated_at)
SELECT '00000000-0000-4000-8000-000000000001','原聊天配置','compatible',base_url,model,1,version,updated_at
FROM provider_configs WHERE kind='chat';
CREATE TABLE model_defaults (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    research_id TEXT REFERENCES model_profiles(id),
    memory_id TEXT REFERENCES model_profiles(id),
    version INTEGER NOT NULL
);
INSERT INTO model_defaults SELECT 1,(SELECT id FROM model_profiles LIMIT 1),NULL,1;
