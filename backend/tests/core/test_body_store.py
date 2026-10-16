"""BodyStore: recorded bodies kept once under their SHA-256, read back whole, swept if orphaned."""

import hashlib
from pathlib import Path

from app.core.body_store import BodyStore


def test_body_is_kept_once_under_its_digest(tmp_path: Path) -> None:
    """The same bytes stored twice are one file named by their SHA-256, read back unchanged."""
    store = BodyStore(str(tmp_path / "bodies"))
    content = b"\x00\xff" * 1000
    ref = store.put(content)
    assert store.put(content) == ref == hashlib.sha256(content).hexdigest()
    assert store.get(ref) == content
    assert [path.name for path in (tmp_path / "bodies").iterdir()] == [ref]


def test_missing_or_malformed_ref_reads_nothing(tmp_path: Path) -> None:
    """An unknown reference, or one that is not a digest (a path escape), reads as None."""
    store = BodyStore(str(tmp_path))
    (tmp_path / "secret").write_bytes(b"x")
    assert store.get("0" * 64) is None
    assert store.get("secret") is None
    assert store.get("../secret") is None


def test_sweep_deletes_only_unreferenced_bodies(tmp_path: Path) -> None:
    """Bodies outside `keep` go; a store never written to sweeps nothing."""
    assert BodyStore(str(tmp_path / "absent")).sweep(set()) == 0
    store = BodyStore(str(tmp_path))
    kept, dropped = store.put(b"kept"), store.put(b"dropped")
    assert store.sweep({kept}) == 1
    assert (store.get(kept), store.get(dropped)) == (b"kept", None)
