---
description: Backend transactions — session.begin() placement rules
globs:
      - backend/app/services/*.py
      - backend/app/repositories/*.py
      - backend/app/routers/*.py
      - backend/app/dependencies/*.py
alwaysApply: false
---

# Backend Transactions

Machine-checked by `check-backend-transaction.ts` (`make check-backend-transaction`).

## Rules

1. **`session.begin()` only in service classes** — never in
   routers/repositories/dependencies/core/engine/models/schemas (checked by
   `transaction/service-only.yml`, which scans every `app/` layer except
   `services/`). The rule matches a bare `session.begin()`,
   `self.session.begin()`, **and any aliased holder** (`svc.session.begin()`):
   reaching the transaction through a service handle is the same violation.
2. **Within services, only in `create`/`update`/`delete` methods** — never in
   read methods (`get`/`list`/`find_*`) (checked by
   `domain/service-transaction-write-only.yml`). A `_`-prefixed write helper
   (`_create_...`) is still a write and may hold one.
3. **`async with self.session.begin():`** — auto commit/rollback, never manual
   `session.commit()`/`session.rollback()` in services

## Why

- Services own the transaction boundary — repositories are stateless
  (they receive the session and operate within the caller's transaction)
- Read methods don't need a transaction — a plain query is fine
- `async with` guarantees rollback on exception (e.g. `NotFoundError`)

## Example

```python
async def create_endpoint(self, project_id: UUID, data: EndpointCreateRequest) -> Endpoint:
    async with self.session.begin():
        return await self.endpoint_repository.create(project_id, data)

async def get_endpoint(self, project_id: UUID, endpoint_id: UUID) -> Endpoint:
    endpoint = await self.endpoint_repository.get(project_id, endpoint_id)  # no session.begin()
    if endpoint is None:
        raise NotFoundError(endpoint_id)
    return endpoint
```

## The Mock Request Log: Its Own Session

Every call to `/mock/{slug}/{path:path}` leaves a `request_log` row - matched
or not, including the one that answers `mock_not_matched`. The mock router hands
the exchange to the request-log service, whose write method opens a **second
session on the same engine** and its own transaction:

```python
async def create_request_log(self, data: RequestLogCreateInternal) -> UUID:
    # expire_on_commit=False: the row's id is read after the commit, and an
    # expired instance would lazy-load there - under asyncio that is a
    # MissingGreenlet, not a query.
    async with AsyncSession(self.session.bind, expire_on_commit=False) as session:
        request_log_repository = RequestLogRepository(session)
        async with session.begin():
            request_log = await request_log_repository.create(data)
        return request_log.id
```

- **Why its own session:** the request's session has already read the project
  and its endpoints to match the call, and that read autobegan a transaction; a
  `session.begin()` on the same session would collide with it. The log is also
  an append-only record of what the caller sent, so it commits on its own and
  does not ride on, or roll back with, anything else the request did.
- **Why `self.session.bind`, not the module engine:** the engine comes from the
  caller's session rather than from `core.database`. Importing the module engine
  gives the process a second answer to "which database", and the API tests -
  which swap the session factory, not the module - would write their log rows
  to the real file.
- It is still a service write: the `session.begin()` sits in a `create_*`
  method of a service class, so both rules above hold. The router never opens
  the session itself.

## Never Do These

- `session.begin()` in routers/repositories/dependencies
- `session.begin()` in service read methods
- Manual `session.commit()`/`session.rollback()` — use `async with`
- Write the mock request log on the request's own session, or open its session
  from the module engine instead of `self.session.bind`
