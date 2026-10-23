from io import BytesIO
from pathlib import Path
import sqlite3
import shutil

import pytest

from yorw_api.storage.workspace import Workspace
from yorw_api.storage.database import Database, MigrationError

MIGRATIONS = Path(__file__).parents[1] / "src/yorw_api/migrations"


def test_restart_preserves_identity_files_and_transactions(tmp_path):
    workspace = Workspace(tmp_path / "workspace")
    db = Database(workspace)
    info = db.workspace_info()
    assert db.connection.execute("PRAGMA foreign_keys").fetchone() == (1,)
    assert db.connection.execute("PRAGMA journal_mode").fetchone() == ("wal",)
    with db.write() as conn:
        conn.execute("CREATE TABLE probe (value TEXT)")
        conn.execute("INSERT INTO probe VALUES ('persisted')")
    with pytest.raises(RuntimeError), db.write() as conn:
        conn.execute("INSERT INTO probe VALUES ('rolled back')")
        raise RuntimeError()
    document_id = workspace.store_document(BytesIO(b"test fixture, not a research paper"))
    db.close()
    # Unknown partial files must survive restart; no speculative cleanup.
    (workspace.root / "tmp/unknown.part").write_bytes(b"interrupted")
    db = Database(Workspace(workspace.root))
    assert db.workspace_info() == info
    assert db.connection.execute("SELECT * FROM probe").fetchall() == [("persisted",)]
    assert workspace.document_path(document_id).read_bytes().startswith(b"test fixture")
    assert (workspace.root / "tmp/unknown.part").exists()
    assert db.connection.execute("SELECT count(*) FROM schema_migrations").fetchone() == (3,)
    db.close()


def migration_copy(tmp_path, second_sql):
    target = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS, target)
    (target / "004_probe.sql").write_text(second_sql, encoding="utf-8")
    return target


def test_upgrade_backup_and_failure_rollback(tmp_path):
    workspace = Workspace(tmp_path / "workspace")
    db = Database(workspace)
    identity = db.workspace_info()["workspace_id"]
    db.close()
    target = migration_copy(tmp_path, "CREATE TABLE probe (value TEXT);\nINSERT INTO missing VALUES (1);\n")
    with pytest.raises(sqlite3.OperationalError):
        Database(workspace, target)
    with sqlite3.connect(workspace.database_path) as conn:
        assert conn.execute("PRAGMA user_version").fetchone() == (3,)
        assert conn.execute("SELECT name FROM sqlite_master WHERE name='probe'").fetchone() is None
    backups = list((workspace.root / "backups").glob("*.sqlite3"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as conn:
        assert conn.execute("SELECT workspace_id FROM workspace_meta").fetchone() == (identity,)
    (target / "004_probe.sql").write_text("CREATE TABLE probe (value TEXT);\n", encoding="utf-8")
    db = Database(workspace, target)
    assert db.version == 4
    db.close()
    before = workspace.database_path.read_bytes()
    with pytest.raises(MigrationError, match="DATABASE_TOO_NEW"):
        Database(workspace)
    assert workspace.database_path.read_bytes() == before


def test_changed_migration_is_rejected_without_writing(tmp_path):
    workspace = Workspace(tmp_path / "workspace")
    Database(workspace).close()
    target = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS, target)
    with (target / "001_workspace.sql").open("a") as output:
        output.write("-- changed\n")
    before = workspace.database_path.read_bytes()
    with pytest.raises(MigrationError, match="MIGRATION_CHECKSUM_CHANGED"):
        Database(workspace, target)
    assert workspace.database_path.read_bytes() == before


def test_backup_failure_blocks_upgrade(tmp_path, monkeypatch):
    workspace = Workspace(tmp_path / "workspace")
    Database(workspace).close()
    target = migration_copy(tmp_path, "CREATE TABLE probe (value TEXT);\n")
    def fail_backup(self):
        raise MigrationError("MIGRATION_BACKUP_FAILED")
    monkeypatch.setattr(Database, "_backup", fail_backup)
    with pytest.raises(MigrationError, match="MIGRATION_BACKUP_FAILED"):
        Database(workspace, target)
    with sqlite3.connect(workspace.database_path) as conn:
        assert conn.execute("PRAGMA user_version").fetchone() == (3,)


def test_managed_paths_and_interrupted_copy(tmp_path):
    workspace = Workspace(tmp_path / "workspace")
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"untouched")
    for value in ["../outside", str(outside), "not-a-uuid"]:
        with pytest.raises(ValueError):
            workspace.remove_document(value)
    class BrokenSource(BytesIO):
        def read(self, size=-1):
            raise OSError("copy interrupted")
    with pytest.raises(OSError):
        workspace.store_document(BrokenSource())
    assert list((workspace.root / "tmp").iterdir()) == []
    assert list((workspace.root / "documents").iterdir()) == []
    assert outside.read_bytes() == b"untouched"


def test_serialized_writes_and_foreign_key_rollback(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    db = Database(Workspace(tmp_path / "workspace"))
    with db.write() as conn:
        conn.execute("CREATE TABLE parent (id INTEGER PRIMARY KEY)")
        conn.execute("CREATE TABLE child (parent_id INTEGER REFERENCES parent(id))")
    def write(number):
        with db.write() as conn:
            conn.execute("INSERT INTO parent VALUES (?)", (number,))
    with ThreadPoolExecutor(max_workers=4) as executor:
        list(executor.map(write, range(20)))
    assert db.connection.execute("SELECT count(*) FROM parent").fetchone() == (20,)
    with pytest.raises(sqlite3.IntegrityError), db.write() as conn:
        conn.execute("INSERT INTO child VALUES (999)")
    assert db.connection.execute("SELECT count(*) FROM child").fetchone() == (0,)
    db.close()


def test_publish_collision_preserves_original(tmp_path, monkeypatch):
    from uuid import uuid4
    import yorw_api.storage.workspace as module
    fixed_id = uuid4()
    monkeypatch.setattr(module, "uuid4", lambda: fixed_id)
    workspace = Workspace(tmp_path / "workspace")
    workspace.store_document(BytesIO(b"original"))
    with pytest.raises(FileExistsError):
        workspace.store_document(BytesIO(b"replacement"))
    assert workspace.document_path(str(fixed_id)).read_bytes() == b"original"


def test_existing_staging_file_is_not_removed(tmp_path, monkeypatch):
    from uuid import uuid4
    import yorw_api.storage.workspace as module
    fixed_id = uuid4()
    monkeypatch.setattr(module, "uuid4", lambda: fixed_id)
    workspace = Workspace(tmp_path / "workspace")
    pending = workspace.root / "tmp" / (str(fixed_id) + ".part")
    pending.write_bytes(b"existing partial import")
    with pytest.raises(FileExistsError):
        workspace.store_document(BytesIO(b"new import"))
    assert pending.read_bytes() == b"existing partial import"
