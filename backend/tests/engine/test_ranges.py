"""byte_range: which bytes a `Range` header asks of a body, and when it is ignored or a 416."""

import pytest

from app.engine.ranges import UNSATISFIABLE, byte_range


@pytest.mark.parametrize(
    ("header", "size", "expected"),
    [
        ("bytes=0-99", 1000, (0, 99)),
        ("bytes=900-2000", 1000, (900, 999)),
        ("bytes=500-", 1000, (500, 999)),
        ("bytes=-100", 1000, (900, 999)),
        ("bytes=-5000", 1000, (0, 999)),
        (" bytes=1-1 ", 10, (1, 1)),
    ],
)
def test_single_range_is_clamped_to_the_body(
    header: str, size: int, expected: tuple[int, int]
) -> None:
    """A last byte past the end, or a suffix longer than the body, is cut to the body."""
    assert byte_range(header, size) == expected


@pytest.mark.parametrize(
    "header",
    [None, "items=0-1", "bytes=0-1,5-6", "bytes=-", "bytes=5-3", "bytes=a-b"],
)
def test_unserved_range_sends_the_whole_body(header: str | None) -> None:
    """No header, another unit, several ranges or a malformed one: the whole body, a 200."""
    assert byte_range(header, 1000) is None


@pytest.mark.parametrize(
    ("header", "size"),
    [("bytes=1000-", 1000), ("bytes=1000-1001", 1000), ("bytes=-0", 1000), ("bytes=-5", 0)],
)
def test_range_past_the_end_is_unsatisfiable(header: str, size: int) -> None:
    """A range starting at or past the end, or an empty suffix, is a 416."""
    assert byte_range(header, size) == UNSATISFIABLE
