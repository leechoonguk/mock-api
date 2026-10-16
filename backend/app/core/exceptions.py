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


class ServiceUnavailableError(Exception):
    """Raised when a dependency the app cannot serve without is unreachable.

    The readiness probe raises it so a caller stops routing traffic; the
    handler answers 503 with the same body shape as every other failure.
    """

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class NotRecordableError(Exception):
    """Raised when a request log has no recorded answer an endpoint can be made from.

    Not forwarded, a request or answer body cut at the log limit or not text, or
    a path, status or header an endpoint cannot hold.
    """

    def __init__(self, request_log_id: UUID) -> None:
        super().__init__("Request log has no upstream answer that can be saved as an endpoint")
        self.request_log_id = request_log_id


class HostTakenError(Exception):
    """Raised when a project claims a host pattern another project already intercepts.

    A request's host must name one project, or the proxy could not tell whose
    endpoints answer it and whose log it lands in.
    """

    def __init__(self, host: str) -> None:
        super().__init__(f"Host {host} is intercepted by another project")
        self.host = host


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

    @app.exception_handler(IntegrityError)
    async def _integrity_handler(request: Request, exc: IntegrityError) -> JSONResponse:
        """A constraint the request violated: a duplicate method, host, path and conditions.

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

    @app.exception_handler(NotRecordableError)
    async def _not_recordable_handler(request: Request, exc: NotRecordableError) -> JSONResponse:
        """The log names a request whose answer cannot become an endpoint."""
        return JSONResponse(
            status_code=422,
            content={
                "detail": "Request log has no upstream answer that can be saved as an endpoint",
                "code": "not_recordable",
                REQUEST_ID_KEY: _request_id(request),
            },
        )

    @app.exception_handler(HostTakenError)
    async def _host_taken_handler(request: Request, exc: HostTakenError) -> JSONResponse:
        """The host the caller named, so the form can mark it."""
        return JSONResponse(
            status_code=409,
            content={
                "detail": f"Host {exc.host} is intercepted by another project",
                "code": "host_taken",
                "host": exc.host,
                REQUEST_ID_KEY: _request_id(request),
            },
        )
