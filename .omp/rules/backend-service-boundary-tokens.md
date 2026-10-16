---
description: Backend service-boundary tokens — transactions and bare tasks outside the service layer, injected while the edit is being written
condition: "async with [\\w.]*session\\.begin\\(|asyncio\\.create_task\\("
scope: "tool:edit(backend/app/routers/*.py), tool:write(backend/app/routers/*.py), tool:edit(backend/app/repositories/*.py), tool:write(backend/app/repositories/*.py), tool:edit(backend/app/dependencies/*.py), tool:write(backend/app/dependencies/*.py)"
interruptMode: always
alwaysApply: false
---

<!-- fires-on backend/app/routers/*.py: async with self.session.begin(): -->
<!-- fires-on backend/app/repositories/*.py: asyncio.create_task(write_log()) -->

# Backend Service Boundary Tokens

This text arrives because the edit currently being written puts a
service-layer-only construct in a router, repository, or dependency module.

The trigger matches each construct, not its name: a comment saying "no
session.begin() here" does not fire it, and an interrupting rule that fires on
the comment explaining the ban is worse than no rule.

## session.begin()

Transaction boundaries live in **services only** — one `async with
self.session.begin():` per write operation. A router or repository that opens a
transaction either nests one inside the service's own or commits work the
service did not decide to commit. Move the call into the service method. The
mock router is no exception: the request log's own session and transaction live
in the request-log service's `create_*` method, not in `routers/mock.py`.
Details: `rule://backend-transaction`.

## asyncio.create_task()

A bare task is unawaited, unlogged, and dies with the request. Do the work in
the request (the mock request log is awaited before the mocked response is
returned), or use FastAPI's `BackgroundTasks` (`background_tasks.add_task(...)`)
so it is tied to the response lifecycle.

## Enforcement

`check-backend-transaction` fails a misplaced `session.begin()` after the edit
lands; this injection is the same invariant delivered before it does. A bare
`asyncio.create_task()` is a convention (not machine-checked) beyond this
injection.
