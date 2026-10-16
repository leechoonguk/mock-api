# ============================================================
# Imports
# ============================================================

from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

import structlog
from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

from app.core.database import engine
from app.core.exceptions import setup_exception_handler
from app.core.logging import configure_logging
from app.core.settings import API_V1_PREFIX, MOCK_PREFIX, settings
from app.routers import health, mock, project


# ============================================================
# Constants
# ============================================================

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

#: Every path under the mocks. A mock is called cross-origin by design, so the
#: CSRF origin check would refuse exactly the requests it exists to answer.
CSRF_EXEMPT_PREFIX = MOCK_PREFIX + "/"

configure_logging(settings.env)
logger = structlog.get_logger(__name__)


# ============================================================
# Middleware
# ============================================================


class SecurityHeaders(BaseHTTPMiddleware):
    """The reference's four security headers - as defaults, never over a mock's own.

    `setdefault`, not assignment: a mock endpoint that declares
    `X-Frame-Options` is reproducing the API it stands in for, and overwriting
    it would make the mock answer something the real API does not.
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-XSS-Protection", "1; mode=block")
        return response


class CsrfProtection(BaseHTTPMiddleware):
    """Reject unsafe browser requests to the admin API from untrusted origins.

    The app has no credentials a browser would attach, but the admin API still
    writes on behalf of whoever can reach it, so a page on another origin must
    not be able to drive it. Origin validation and Fetch Metadata do that
    without a token. The mocks are exempt (`CSRF_EXEMPT_PREFIX`).
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)
        self.trusted_origins = frozenset(
            origin.rstrip("/") for origin in settings.csrf_trusted_origins
        )

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.method in SAFE_METHODS or request.url.path.startswith(CSRF_EXEMPT_PREFIX):
            return await call_next(request)

        origin = request.headers.get("Origin")
        trusted_origin = origin is not None and origin.rstrip("/") in self.trusted_origins
        fetch_site = request.headers.get("Sec-Fetch-Site")
        if (origin is not None and not trusted_origin) or (
            fetch_site == "cross-site" and not trusted_origin
        ):
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF validation failed"},
                headers={"Vary": "Origin, Sec-Fetch-Site"},
            )

        response = await call_next(request)
        response.headers["Vary"] = "Origin, Sec-Fetch-Site"
        return response


# ============================================================
# Lifespan
# ============================================================


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncGenerator[None]:
    yield
    await engine.dispose()


# ============================================================
# App Setup
# ============================================================

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Mock API server: projects of mocked endpoints, and the log of what they were sent",
    lifespan=_lifespan,
)
setup_exception_handler(app)
# Host header first: a request for an unknown host is refused before any other
# middleware spends work on it.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
app.add_middleware(CsrfProtection)
app.add_middleware(SecurityHeaders)


@app.middleware("http")
async def request_context(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    request_id = request.headers.get("X-Request-ID") or str(uuid4())
    request.state.request_id = request_id
    started = perf_counter()
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        method=request.method,
        path=request.url.path,
    )
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
    except Exception:
        logger.exception("request_failed", status_code=500)
        raise
    finally:
        logger.info(
            "request_completed",
            status_code=status_code,
            duration_ms=round((perf_counter() - started) * 1000, 2),
        )
        structlog.contextvars.clear_contextvars()
    # A mock may declare its own X-Request-ID; it wins, like every mocked header.
    response.headers.setdefault("X-Request-ID", request_id)
    return response


# No credentials (there is no authentication and no cookie), so `*` exposes
# nothing; `expose_headers` lets a browser client read a mock's own headers.
# A browser preflight (OPTIONS with Access-Control-Request-Method) is answered
# here and never reaches an OPTIONS mock endpoint.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ============================================================
# Router Registration
# ============================================================

app.include_router(health.router)
app.include_router(mock.router)

api_router = APIRouter(prefix=API_V1_PREFIX)
api_router.include_router(project.router)
app.include_router(api_router)
