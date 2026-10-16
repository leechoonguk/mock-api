# ============================================================
# Imports
# ============================================================

import hashlib
import os
import re
import tempfile
from collections.abc import Collection
from pathlib import Path

from app.core.settings import settings


# ============================================================
# Constants
# ============================================================

#: A stored body's name: the SHA-256 of its bytes, so one body is kept once.
BODY_REF = re.compile(r"^[0-9a-f]{64}$")


# ============================================================
# Classes
# ============================================================


class BodyStore:
    """Recorded bodies too large or too binary for a database column, as files.

    Content-addressed: a body is written once under its SHA-256, so the same
    video segment recorded twice takes the space once. Written whole to a
    temporary file and renamed, so a reader never sees half a body.
    """

    def __init__(self, directory: str) -> None:
        self.directory = Path(directory)

    def put(self, content: bytes) -> str:
        """Keep `content`; its reference, the SHA-256 hex digest."""
        ref = hashlib.sha256(content).hexdigest()
        path = self.directory / ref
        if not path.is_file():
            self.directory.mkdir(parents=True, exist_ok=True)
            handle, temporary = tempfile.mkstemp(dir=self.directory)
            with os.fdopen(handle, "wb") as file:
                file.write(content)
            Path(temporary).replace(path)
        return ref

    def get(self, ref: str) -> bytes | None:
        """The body stored under `ref`, or None when there is none (or `ref` is no reference)."""
        path = self.directory / ref
        if BODY_REF.match(ref) is None or not path.is_file():
            return None
        return path.read_bytes()

    def sweep(self, keep: Collection[str]) -> int:
        """Delete every stored body not in `keep`; how many went."""
        if not self.directory.is_dir():
            return 0
        removed = 0
        for path in self.directory.iterdir():
            if path.name not in keep:
                path.unlink()
                removed += 1
        return removed


# ============================================================
# Functions
# ============================================================


def body_store() -> BodyStore:
    """The store at the configured directory - read at call time, so tests can move it."""
    return BodyStore(settings.body_store_dir)
