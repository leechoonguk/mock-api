# ============================================================
# Imports
# ============================================================

from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator


# ============================================================
# Constants
# ============================================================

#: A timestamp read back from SQLite, answered as the UTC instant it is.
#: SQLite stores no offset, so a `DateTime(timezone=True)` column comes back
#: naive; serialized as is, a browser would read it as local time and every
#: time on the screen would be off by the reader's UTC offset.
UtcDateTime = Annotated[
    datetime,
    AfterValidator(lambda value: value if value.tzinfo is not None else value.replace(tzinfo=UTC)),
]
