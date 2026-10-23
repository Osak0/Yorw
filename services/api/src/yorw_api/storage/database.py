"""Checked, transactional SQLite migrations and one serialized write connection."""
from contextlib import contextmanager
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import sqlite3
from threading import RLock
from uuid import uuid4

from .workspace import Workspace


class MigrationError(RuntimeError):
    """A safe error code that can cross the startup handshake."""


class Database:
    def __init__(self, workspace: Workspace, migrations: Path | None = None):
        self.workspace = workspace
        self.lock = RLock()
        self.connection = sqlite3.connect(workspace.database_path, isolation_level=None, check_same_thread=False)
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute("PRAGMA busy_timeout=5000")
        try:
            directory = migrations or Path(__file__).resolve().parents[1] / "migrations"
            scripts = sorted(directory.glob("*.sql"))
            if not scripts or [int(p.name.split('_')[0]) for p in scripts] != list(range(1, len(scripts) + 1)):
                raise MigrationError("MIGRATION_FILES_INVALID")
            contents = [p.read_bytes() for p in scripts]
            # Git may convert LF to CRLF on Windows. Compare only exact EOL variants;
            # all SQL text, comments and other whitespace remain protected by SHA-256.
            canonical = [data.replace(b'\r\n', b'\n') for data in contents]
            checksums = [sha256(data).hexdigest() for data in canonical]
            compatible = [{sha256(raw).hexdigest(), sha256(lf).hexdigest(),
                           sha256(lf.replace(b'\n', b'\r\n')).hexdigest()}
                          for raw, lf in zip(contents, canonical)]
            has_history = self.connection.execute("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").fetchone()
            history = self.connection.execute("SELECT version, checksum FROM schema_migrations ORDER BY version").fetchall() if has_history else []
            version = self.connection.execute("PRAGMA user_version").fetchone()[0]
            if version > len(scripts) or any(v > len(scripts) for v, _ in history):
                raise MigrationError("DATABASE_TOO_NEW")
            if [v for v, _ in history] != list(range(1, version + 1)):
                raise MigrationError("MIGRATION_HISTORY_INVALID")
            if any(checksum not in compatible[v - 1] for v, checksum in history):
                raise MigrationError("MIGRATION_CHECKSUM_CHANGED")
            if not has_history and self.connection.execute("SELECT 1 FROM sqlite_master WHERE type='table'").fetchone():
                raise MigrationError("UNKNOWN_DATABASE")
            self._check_integrity()
            if version and version < len(scripts):
                self._backup()
            self.connection.execute("PRAGMA journal_mode=WAL")
            for index in range(version, len(scripts)):
                with self.write() as db:
                    db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)")
                    statement = ""
                    for line in contents[index].decode("utf-8").splitlines(True):
                        statement += line
                        if sqlite3.complete_statement(statement):
                            db.execute(statement)
                            statement = ""
                    if statement.strip():
                        raise MigrationError("MIGRATION_SQL_INCOMPLETE")
                    if index == 0:
                        db.execute("INSERT INTO workspace_meta VALUES (1, ?, ?)", (str(uuid4()), datetime.now(timezone.utc).isoformat()))
                    db.execute("INSERT INTO schema_migrations VALUES (?, ?, ?)", (index + 1, checksums[index], datetime.now(timezone.utc).isoformat()))
                    db.execute(f"PRAGMA user_version={index + 1}")
                    self._check_integrity()
            self.version = len(scripts)
        except BaseException:
            self.connection.close()
            raise

    def _check_integrity(self):
        if self.connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise MigrationError("DATABASE_INTEGRITY_FAILED")
        if self.connection.execute("PRAGMA foreign_key_check").fetchone():
            raise MigrationError("DATABASE_FOREIGN_KEYS_FAILED")

    def _backup(self):
        path = self.workspace.root / "backups" / f"before-migration-{uuid4()}.sqlite3"
        try:
            with sqlite3.connect(path) as backup:
                self.connection.backup(backup)
        except Exception as error:
            path.unlink(missing_ok=True)
            raise MigrationError("MIGRATION_BACKUP_FAILED") from error

    @contextmanager
    def write(self):
        with self.lock:
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                yield self.connection
                self.connection.execute("COMMIT")
            except BaseException:
                self.connection.execute("ROLLBACK")
                raise

    def workspace_info(self) -> dict:
        with self.lock:
            row = self.connection.execute("SELECT workspace_id, created_at FROM workspace_meta WHERE singleton=1").fetchone()
            return {"workspace_id": row[0], "created_at": row[1], "schema_version": self.version}

    def close(self):
        with self.lock:
            self.connection.close()
