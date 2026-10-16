# ============================================================
# Imports
# ============================================================

from pydantic import BaseModel, ConfigDict


# ============================================================
# Classes
# ============================================================


class Page[T](BaseModel):
    """One page of a collection, and how large the collection is.

    Every list endpoint answers in this shape. A bare array cannot say how much
    it is a page of, so a client paging it could only infer "there is another
    page", never "how many there are".

    `total` is the count under the same filter as `items`, without the window.
    """

    model_config = ConfigDict(extra="forbid")

    items: list[T]
    total: int
