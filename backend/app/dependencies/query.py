# ============================================================
# Imports
# ============================================================

from typing import Annotated, Literal

from fastapi import Query

from app.engine.matcher import RequestMethod
from app.schemas.request_log import LogOutcome, StatusClass


# ============================================================
# Constants
# ============================================================

#: The longest fragment a text filter takes - the widest filtered column.
TEXT_FILTER_MAX_LENGTH = 120

#: How many values one multi-select filter takes - more than any closed vocabulary here holds.
FILTER_VALUES_MAX = 10


# ============================================================
# Dependencies
# ============================================================

# Annotated aliases so routers never use inline Query(): one spelling of each
# parameter, its bounds declared once. Defaults are set with `=` at the call
# site, not inside Annotated.

OffsetQuery = Annotated[int, Query(ge=0)]
# `le=100` is written as a literal: it is the page cap `ITEMS_PER_USER` must
# stay under, and check-backend-router-params reads it from this line.
LimitQuery = Annotated[int, Query(ge=1, le=100)]

#: A contains-filter on one text column, named after the column it filters
#: (`name=dem`). `min_length=1` because an empty string is the absence of a
#: filter spelled a second way - the caller omits the parameter instead.
TextFilterQuery = Annotated[str | None, Query(min_length=1, max_length=TEXT_FILTER_MAX_LENGTH)]

#: Which way a sorted list runs. One closed pair, so a typo is a 422 at the
#: boundary and the repository never sees a word it cannot switch on.
OrderQuery = Annotated[Literal["asc", "desc"], Query()]

#: Which column the project list is sorted by - the columns its grid can sort.
#: Closed on purpose: an open string would be one `getattr` away from a 500.
ProjectSortQuery = Annotated[Literal["name", "created_at"] | None, Query()]

#: The log screen's multi-selects: the parameter repeated (`method=GET&method=POST`), ORed.
MethodFilterQuery = Annotated[list[RequestMethod] | None, Query(max_length=FILTER_VALUES_MAX)]
StatusClassFilterQuery = Annotated[list[StatusClass] | None, Query(max_length=FILTER_VALUES_MAX)]
OutcomeFilterQuery = Annotated[list[LogOutcome] | None, Query(max_length=FILTER_VALUES_MAX)]
