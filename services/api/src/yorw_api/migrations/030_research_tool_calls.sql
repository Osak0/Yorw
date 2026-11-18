-- R2 agent loop: durable tool-call records.
-- Summaries only: never hidden reasoning, provider keys or full note bodies.
CREATE TABLE research_tool_calls (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES research_tasks(id),
    session_id TEXT NOT NULL REFERENCES research_sessions(id),
    call_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    input_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT,
    error_json TEXT,
    correctable INTEGER,
    refs_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);
CREATE INDEX research_tool_calls_task ON research_tool_calls(task_id, sequence);
