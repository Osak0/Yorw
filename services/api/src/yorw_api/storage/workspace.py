"""Workspace paths and managed files. No business-level import policy here."""
from pathlib import Path
from typing import BinaryIO
from uuid import UUID, uuid4
import os
import shutil

ALLOWED_EXTENSIONS = {'pdf', 'docx', 'doc', 'md', 'txt'}


class Workspace:
    def __init__(self, root: Path):
        if not root.is_absolute():
            raise ValueError("Workspace path must be absolute")
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        for name in ("documents", "tmp", "logs", "backups"):
            folder = self.root / name
            if folder.resolve() != folder or folder.is_symlink():
                raise ValueError("Workspace directory must not redirect outside its location")
            folder.mkdir(exist_ok=True)
        self.database_path = self.root / "yorw.sqlite3"
        if self.database_path.is_symlink() or self._redirects(self.database_path):
            raise ValueError("Database path must not redirect")

    @staticmethod
    def _redirects(path: Path) -> bool:
        resolved = path.resolve()
        if resolved == path:
            return False
        # Windows MSIX can return a virtualized spelling of the same physical
        # parent. Only accept OS-confirmed identity, never arbitrary new parents.
        return not (path.exists() and resolved.name.casefold() == path.name.casefold()
                    and resolved.parent.samefile(path.parent))

    def document_path(self, document_id: str, extension: str = 'pdf') -> Path:
        if str(UUID(document_id)) != document_id:
            raise ValueError("Expected canonical document UUID")
        extension = extension.lower().lstrip('.')
        if extension not in ALLOWED_EXTENSIONS:
            raise ValueError("Unsupported document extension")
        path = self.root / "documents" / f"{document_id}.{extension}"
        if self._redirects(path):
            raise ValueError("Managed path must not redirect")
        return path

    def store_document(self, source: BinaryIO, document_id: str | None = None,
                       extension: str = 'pdf') -> str:
        """Stage then publish under a fresh ID; never replace an existing file."""
        document_id = document_id or str(uuid4())
        self.document_path(document_id, extension)
        staging = self.root / "tmp" / (document_id + ".part")
        destination = self.document_path(document_id, extension)
        created = False
        try:
            with staging.open("xb") as output:
                created = True
                shutil.copyfileobj(source, output)
                output.flush()
                os.fsync(output.fileno())
            # On Windows rename fails if destination exists, preserving old data.
            # A hard link gives the same no-overwrite guarantee on all platforms.
            os.link(staging, destination)
            return document_id
        finally:
            if created:
                staging.unlink(missing_ok=True)

    def remove_document(self, document_id: str, extension: str = 'pdf') -> None:
        self.document_path(document_id, extension).unlink(missing_ok=True)
