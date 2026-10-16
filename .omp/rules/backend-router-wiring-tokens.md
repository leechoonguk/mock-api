---
description: Backend router wiring tokens — inline FastAPI parameter constructors, injected while the edit is being written
condition: "\\b(Depends|Query|Path|Body|Header)\\("
scope: "tool:edit(backend/app/routers/*.py), tool:write(backend/app/routers/*.py)"
interruptMode: always
alwaysApply: false
---

<!-- fires-on backend/app/routers/*.py: service: ProjectService = Depends(get_project_service) -->

# Backend Router Wiring Tokens

This text arrives because the router edit currently being written calls a FastAPI
parameter constructor inline. Routers declare *which* shared dependency they use,
never *how* it is built.

## Depends() / Query() / Path() / Body() / Header()

Every one of these belongs in `app/dependencies/`, behind an `Annotated` alias:

```python
# app/dependencies/services.py
ProjectServiceDep = Annotated[ProjectService, Depends(get_project_service)]
# app/dependencies/query.py
OffsetQuery = Annotated[int, Query(ge=0)]

# app/routers/project.py — the router only names the alias
async def list_projects(project_service: ProjectServiceDep, offset: OffsetQuery = 0) -> Page[ProjectReadResponse]:
```

An inline constructor repeats a wiring decision at every endpoint: the provider,
its scope, and its validation live in the signature instead of in one place, so a
change has to be made N times and a reader cannot tell which shared dependency an
endpoint actually uses. Details: `rule://backend-router-params`.

The four legal parameter kinds are path params, a `*Request` body named `data`,
`*Dep` dependencies, and `*Query` aliases — nothing else.

## Enforcement

`check-backend-router-params` refuses an `Annotated` alias declared in a router
and any parameter that is not one of the four kinds; the inline constructor
itself is a convention (not machine-checked) that this injection delivers while
the edit is being written.
