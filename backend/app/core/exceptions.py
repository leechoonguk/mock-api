# ============================================================
# Imports
# ============================================================

from uuid import UUID

from fastapi import FastAPI, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError
from starlette.responses import JSONResponse


# ============================================================
# Constants
# ============================================================

REQUEST_ID_KEY = "request_id"

# What a dependency being down answers - the 503 body's code.
SERVICE_UNAVAILABLE_CODE = "service_unavailable"


# ============================================================
# Classes
# ============================================================


class NotFoundError(Exception):
    """Raised when a resource is not found.

    Handled by setup_exception_handler — no need for HTTPException in routers.
    """

    def __init__(self, resource_id: UUID | str) -> None:
        super().__init__("Resource not found")
        self.resource_id = resource_id


class MockNotMatchedError(Exception):
    """Raised when a project exists but none of its enabled endpoints answers the request.

    Its own code, not `not_found`: the caller of a mock must tell "no such
    project" (a wrong base URL) from "no endpoint for this method and path"
    (a mock not written yet), and the body says which request missed.
    """

    def __init__(self, method: str, path: str) -> None:
        super().__init__(f"No mock endpoint matches {method} {path}")
        self.method = method
        self.path = path


class ServiceUnavailableError(Exception):
    """Raised when a dependency the app cannot serve without is unreachable.

    The readiness probe raises it so a caller stops routing traffic; the
    handler answers 503 with the same body shape as every other failure.
    """

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


# ============================================================
# Functions
# ============================================================


def _request_id(request: Request) -> str:
    return getattr(request.state, REQUEST_ID_KEY, request.headers.get("X-Request-ID", "unknown"))


def setup_exception_handler(app: FastAPI) -> None:
    """Register domain exception handlers to return uniform JSON responses.

    Each handler keeps its own `detail`, `code` and request id literals:
    `check-backend-exceptions` reads the body of the handler it governs, and
    the frontend's error translations are keyed by these codes.
    """

    @app.exception_handler(NotFoundError)
    async def _not_found_handler(request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            content={
                "detail": "Resource not found",
                "code": "not_found",
                REQUEST_ID_KEY: _request_id(request),
            },
        )

    @app.exception_handler(MockNotMatchedError)
    async def _mock_not_matched_handler(request: Request, exc: MockNotMatchedError) -> JSONResponse:
        """The miss, with the method and path the mock was asked for.

        Echoed because the caller is usually a program under test whose logs
        show only this body: what it requested is the first thing to compare
        against the endpoints the project declares.
        """
        return JSONResponse(
            status_code=404,
            content={
                "detail": f"No mock endpoint matches {exc.method} {exc.path}",
                "code": "mock_not_matched",
                "method": exc.method,
                "path": exc.path,
                REQUEST_ID_KEY: _request_id(request),
            },
        )

    @app.exception_handler(IntegrityError)
    async def _integrity_handler(request: Request, exc: IntegrityError) -> JSONResponse:
        """A constraint the request violated: a taken slug, a duplicate method and path.

        The detail stays generic on purpose - a database message names columns
        and constraints the caller has no business reading.
        """
        return JSONResponse(
            status_code=409,
            content={
                "detail": "Request conflicts with existing data",
                "code": "conflict",
                REQUEST_ID_KEY: _request_id(request),
            },
        )

    @app.exception_handler(StaleDataError)
    async def _stale_data_handler(request: Request, exc: StaleDataError) -> JSONResponse:
        """Optimistic lock miss: another transaction updated the row first."""
        return JSONResponse(
            status_code=409,
            content={
                "detail": "Resource was modified by another request — reload and retry",
                "code": "stale_version",
                REQUEST_ID_KEY: _request_id(request),
            },
        )

    @app.exception_handler(ServiceUnavailableError)
    async def _service_unavailable_handler(
        request: Request, exc: ServiceUnavailableError
    ) -> JSONResponse:
        """Readiness failure: the dependency is down, the app is not serving."""
        return JSONResponse(
            status_code=503,
            content={
                "detail": exc.detail,
                "code": SERVICE_UNAVAILABLE_CODE,
                REQUEST_ID_KEY: _request_id(request),
            },
        )
