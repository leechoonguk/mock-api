"""The page envelope: every list answers its items and the unwindowed total."""

import pytest
from pydantic import ValidationError

from app.core.page import Page


def test_page_carries_items_and_total() -> None:
    """`total` is independent of the window, which is what lets a grid show `1-2 of 5`."""
    page = Page[int](items=[1, 2], total=5)
    assert page.model_dump() == {"items": [1, 2], "total": 5}


def test_page_refuses_unknown_fields() -> None:
    """A misspelt envelope key must fail loudly instead of being dropped on the wire."""
    with pytest.raises(ValidationError):
        Page[int](items=[], total=0, count=0)  # type: ignore[call-arg]
