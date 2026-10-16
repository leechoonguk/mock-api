# ============================================================
# Imports
# ============================================================

import asyncio
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

import structlog
from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

import app.core.database as database
import app.routers.proxy as proxy
import app.routers.request_log as request_log
from app.core.database import engine
from app.core.exceptions import setup_exception_handler
from app.core.logging import configure_logging
from app.core.proxy import InterceptingProxy
from app.core.settings import API_V1_PREFIX, PROXY_HOST, settings
from app.dependencies.proxy import MockInterceptHandler
from app.routers import health, project
from app.services.mock import MockService


# ============================================================
# Constants
# ============================================================

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

configure_logging(settings.env)
logger = structlog.get_logger(__name__)


# ============================================================
# Middleware
# ============================================================


class SecurityHeaders(BaseHTTPMiddleware):
    """The reference's four security headers, as defaults a response may already set.

    The mocks are answered by the proxy, not this app, so these reach the
    admin API and the health probe only.
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
    without a token.
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
        if request.method in SAFE_METHODS:
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
    """Run the forward proxy beside the API, on its own thread, for the app's lifetime.

    A proxy that cannot listen (the port is taken) is logged and left down: the
    admin API still serves, and `GET /api/v1/proxy` reports it as not listening.
    Before it starts, the stored answers nothing refers to any more are swept.
    """
    intercepting_proxy: InterceptingProxy | None = None
    if settings.proxy_enabled:
        async with AsyncSession(engine, expire_on_commit=False) as session:
            swept = await MockService(session).delete_orphan_bodies()
        logger.info("orphan_bodies_swept", count=swept)
        intercepting_proxy = InterceptingProxy(
            _proxy_handler,
            host=PROXY_HOST,
            port=settings.proxy_port,
            confdir=settings.proxy_confdir,
        )
        await asyncio.to_thread(intercepting_proxy.start)
        if intercepting_proxy.address is None:
            logger.error("proxy_not_listening", port=settings.proxy_port)
    app.state.proxy = intercepting_proxy
    yield
    if intercepting_proxy is not None:
        await asyncio.to_thread(intercepting_proxy.stop)
    await engine.dispose()


def _proxy_handler() -> MockInterceptHandler:
    """The proxy's handler, on an engine of its own - called on the proxy's thread and loop."""
    return MockInterceptHandler(
        async_sessionmaker(database.create_engine(), class_=AsyncSession, expire_on_commit=False)
    )


# ============================================================
# App Setup
# ============================================================

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Mock API server: a forward proxy that records the hosts a project names, "
    "and answers them from mocked endpoints",
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
    response.headers.setdefault("X-Request-ID", request_id)
    return response


# No credentials (there is no authentication and no cookie), so `*` exposes
# nothing. The admin UI reaches the API through Vite's proxy (same origin);
# this keeps a tool on another origin able to read it.
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
api_router = APIRouter(prefix=API_V1_PREFIX)
api_router.include_router(project.router)
api_router.include_router(request_log.router)
api_router.include_router(proxy.router)
app.include_router(api_router)
