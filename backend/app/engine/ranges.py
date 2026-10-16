# ============================================================
# Imports
# ============================================================

import re
from typing import Literal


# ============================================================
# Constants
# ============================================================

#: One byte range (RFC 9110 §14.1.2): `bytes=first-last`, `bytes=first-` or the
#: suffix `bytes=-length`. Several ranges in one header are not served as such.
SINGLE_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")

#: What `byte_range` answers for a range that lies wholly past the body's end.
UNSATISFIABLE: Literal["unsatisfiable"] = "unsatisfiable"


# ============================================================
# Functions
# ============================================================


def byte_range(header: str | None, size: int) -> tuple[int, int] | Literal["unsatisfiable"] | None:
    """The inclusive `(first, last)` bytes a `Range` header asks of a body of `size` bytes.

    None when the whole body should be sent: no header, a unit other than
    bytes, several ranges or a malformed one - a server may ignore a Range it
    does not serve (RFC 9110 §14.2). `UNSATISFIABLE` when the range starts at or
    past the end, which is a 416.
    """
    match = None if header is None else SINGLE_RANGE.match(header.strip())
    if match is None:
        return None
    first, last = match.group(1), match.group(2)
    if first == "":
        if last == "" or int(last) == 0:
            return None if last == "" else UNSATISFIABLE
        return (max(size - int(last), 0), size - 1) if size > 0 else UNSATISFIABLE
    start = int(first)
    end = size - 1 if last == "" else min(int(last), size - 1)
    if start >= size or (last != "" and int(last) < start):
        return UNSATISFIABLE if start >= size else None
    return start, end
