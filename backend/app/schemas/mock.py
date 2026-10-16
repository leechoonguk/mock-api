# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.engine.matcher import ANY_METHOD, METHODS
from app.schemas.endpoint import EndpointReadResponse


# ============================================================
# Constants
# ============================================================

#: The methods a mock is called with - every declared method except `ANY`,
#: which is a wildcard of the declaration, not a method a client sends.
REQUEST_METHODS = [method for method in METHODS if method != ANY_METHOD]


# ============================================================
# Classes
# ============================================================


class MockResolution(BaseModel):
    """Which project a mocked request reached, and the endpoint that answers it, if any.

    `endpoint` is a snapshot read before the response is delayed and rendered,
    so an edit saved meanwhile cannot change the answer halfway through.
    """

    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    endpoint: EndpointReadResponse | None
    params: dict[str, str]
