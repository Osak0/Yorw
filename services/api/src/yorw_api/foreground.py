"""Checked under the caller's SQLite write transaction: never queue paid work."""
from fastapi import HTTPException


def assert_idle(conn):
    checks = [
        "SELECT 1 FROM research_tasks WHERE status='running' LIMIT 1",
        "SELECT 1 FROM messages WHERE status='running' LIMIT 1",
        "SELECT 1 FROM suggestions WHERE status='running' LIMIT 1",
        "SELECT 1 FROM tasks WHERE kind IN ('ai_chat','ai_draft','enrich') AND status IN ('queued','running') LIMIT 1",
    ]
    for sql in checks:
        if conn.execute(sql).fetchone():
            raise HTTPException(409, detail='FOREGROUND_BUSY')
