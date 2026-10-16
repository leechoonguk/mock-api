# ============================================================
# Imports
# ============================================================

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.database import engine
from app.core.proxy import InterceptingProxy


# ============================================================
# Constants
# ============================================================

async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


# ============================================================
# Functions
# ============================================================


async def get_session() -> AsyncIterator[AsyncSession]:
    """Inject an AsyncSession for the request lifecycle.

    The transaction is opened by the service's write methods
    (`async with self.session.begin()`); this only owns the session's lifetime.
    The factory is read at call time, so the test suite can swap it.
    """
    session = async_session_factory()
    try:
        yield session
    finally:
        await session.close()


def get_intercepting_proxy(request: Request) -> InterceptingProxy | None:
    """The forward proxy the lifespan started, or None when it is turned off."""
    return getattr(request.app.state, "proxy", None)


# ============================================================
# Dependencies
# ============================================================

SessionDep = Annotated[AsyncSession, Depends(get_session)]
InterceptingProxyDep = Annotated[InterceptingProxy | None, Depends(get_intercepting_proxy)]
