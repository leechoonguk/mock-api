# ============================================================
# Imports
# ============================================================

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.proxy import HttpAnswer, InterceptedRequest
from app.services.mock import MockService


# ============================================================
# Classes
# ============================================================


class MockInterceptHandler:
    """The proxy's `InterceptHandler`: each call on its own session, answered by `MockService`.

    Built on the proxy's thread (see `main.py`), so the session factory's engine
    opens its connections on the proxy's event loop; the tests pass their own.
    """

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self.session_factory = session_factory

    async def intercepts(self, host: str) -> bool:
        async with self.session_factory() as session:
            return await MockService(session).intercepts(host)

    async def answer(self, request: InterceptedRequest) -> HttpAnswer | None:
        async with self.session_factory() as session:
            return await MockService(session).answer_request(request)

    async def forwarded(self, request: InterceptedRequest, answer: HttpAnswer | None) -> None:
        async with self.session_factory() as session:
            await MockService(session).create_forwarded_log(request, answer)
