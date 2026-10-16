"""UTC timestamps: SQLite hands back naive datetimes, the API answers aware ones."""

from datetime import UTC, datetime, timedelta, timezone

from pydantic import BaseModel

from app.core.timestamps import UtcDateTime


class Stamped(BaseModel):
    """A response shape with one timestamp, as every read response carries."""

    at: UtcDateTime


def test_naive_timestamp_is_read_as_utc() -> None:
    """Without the offset a browser would read the time as local and shift it."""
    stamped = Stamped(at=datetime(2026, 1, 1, 9, 30))
    assert stamped.at.tzinfo is UTC
    assert stamped.model_dump_json() == '{"at":"2026-01-01T09:30:00Z"}'


def test_aware_timestamp_keeps_its_offset() -> None:
    """A value that already names its zone is an instant and must not be relabelled."""
    seoul = timezone(timedelta(hours=9))
    stamped = Stamped(at=datetime(2026, 1, 1, 9, 30, tzinfo=seoul))
    assert stamped.at.utcoffset() == timedelta(hours=9)
