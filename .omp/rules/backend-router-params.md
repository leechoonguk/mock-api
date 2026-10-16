---
description: Backend router parameters — path/body/dependency/query kinds, UUID ids, pagination aliases, signature order
globs:
      - backend/app/routers/*.py
      - backend/app/dependencies/query.py
alwaysApply: false
---

# Backend Router Parameters

An endpoint's signature is its contract with every caller and with OpenAPI. Each
parameter is exactly one of four kinds, and each kind has one spelling — so a
reader knows what identifies the resource, what it accepts, and what is wiring,
without reading the body.

Machine-checked by `check-backend-router-params.ts` (`make check-backend-router-params`).
The "no inline `Query()`/`Depends()` call" half is a convention (not
machine-checked) beyond the hook's refusal of a router-declared `Annotated` alias.

The mock router (`routers/mock.py`, `/mock/{slug}/{path:path}`, any method) is
the one router whose signature is not an admin contract: it reads the raw
`Request` because the method, headers, query and body are the data it matches
and logs. Its path parameters still follow the path rules below.

## A Filter Parameter Reaches A Predicate

A router parameter typed `TextFilterQuery` or a list alias must narrow the query
in the domain's repository, with the match the alias promises: `ilike` for
text, `.in_()` for a list. The failure is silent in every direction - a filter
the repository never reads answers the whole collection under a filter label;
a picked value applied with `ilike` returns `orders-v2` to a reader who picked
`orders`; a fragment applied with `==` answers nothing. Each leaves every other
gate green: the router, the service and the screen are all correct about a
parameter that does nothing.

`check-backend-router-params` reads every filter-typed parameter of each router
and looks for it in the repository predicates of **the domain the router
serves** (`routers/project.py` → `repositories/project.py`, or the files of
`repositories/project/` for a folder domain, matched to the table the path
reads) - a direct `.where(Project.name.ilike(f"%{name}%"))` or a
`for column, value in (...)` loop for text, and for a list
`if filters.<name>: query = query.where(... .in_(filters.<name>))` or the same
loop whose body applies `.in_(value)`. The `.in_` may sit inside a relationship
walk that reaches the column, but not past the `)` that closes the `where` - a
decoy predicate in a sibling repository must not satisfy the search while the
real one has dropped the filter.

## A Whole-Value Filter Is A Multi-Select

A filter whose value is picked from a closed vocabulary - a `Literal` the schema
closes (an endpoint's `method`), or the column's own values through `facets` -
takes **any number of values**: the screen's select ticks several and the
router ORs them (rule://frontend-screens, Select filters). The alias is a list:

```python
ExactFilterValue = Annotated[str, StringConstraints(min_length=1, max_length=TEXT_FILTER_MAX_LENGTH)]
MethodFilterQuery = Annotated[list[EndpointMethod] | None, Query(max_length=FILTER_VALUES_MAX)]
```

- The wire is the parameter repeated (`method=GET&method=POST`);
  `max_length` bounds the **list** - each value's bounds live on its element type.
- The filter holds `list[X] = Field(default_factory=list)`, the router
  passes `value or []`, and the repository applies `if filters.<name>:` - the
  empty list is the absence of a filter, never `IN ()`.
- A single-value vocabulary alias (`Annotated[EndpointMethod | None, Query()]`) is
  refused on every endpoint: a screen could send only one of the values its box
  lets the reader tick.

## The Four Kinds

| Kind | Spelling | Example |
|---|---|---|
| **Path** | declared in the route template, no default | `project_id: UUID` |
| **Body** | one `*Request` schema named `data`, writes only | `data: ProjectCreateRequest` |
| **Dependency** | `Annotated` alias ending in `Dep`, from `app/dependencies/` | `project_service: ProjectServiceDep` |
| **Query** | `Annotated` alias ending in `Query`, from `app/dependencies/query.py` | `offset: OffsetQuery = 0` |

A parameter that fits none of the four is a bare primitive: no bound, no
OpenAPI constraint, no reuse. It is a violation, not a shortcut.

## Signature Order

```text
path → body → dependencies → query (with defaults)
```

What identifies the resource comes first, then what the caller sends, then the
wiring, then the optional knobs. Python already forces defaults last; the rest is
so every endpoint reads the same.

## Path Parameters

- **Every `{name}` in the route template is a signature parameter with the same
  name.** A mismatch is not a type error: FastAPI turns the unknown name into a
  *required query parameter*, so every call answers 422 and the path segment is
  ignored.
- **Ids are `UUID`** (`project_id: UUID`, `endpoint_id: UUID`,
  `request_log_id: UUID`) — a malformed id fails at the boundary instead of
  reaching the database. Natural keys stay `str` (the mock router's
  `slug: str`, `path: str`). An id is named `<table>_id` after the table it
  reads (convention, not machine-checked).
- **No defaults.** A path segment that can be omitted is a different route.

## Body

- Writes (`POST`/`PUT`/`PATCH`) take **exactly one** `*Request` schema named
  `data`. Two body parameters make FastAPI embed each under its own key, which
  silently changes the wire format.
- **`GET` and `DELETE` take no body.** Proxies, caches and some clients drop it,
  so an endpoint whose semantics depend on it fails only in production.

## Query and Pagination

- A filter on a column the schema closes with a `Literal` (`EndpointMethod`) is
  a list of that `Literal`: the `Literal` validates each value, so one outside it
  is a 422 at the boundary and the filter object never holds a string it cannot
  switch on.

- **A list over free strings owes a `facets` route.** Its values match whole
  because the caller picked them from the column's own values, and
  `GET <prefix>/facets` is where those come from; its response model declares a
  field per such column. `check-backend-router-params` fails the missing route
  and the missing field - without them the screen's select offers nothing,
  which is a filter that cannot filter. A list of a `Literal` is exempt: its
  values are the contract's constant.

- Bounds are declared **once**, in `app/dependencies/query.py`:

  ```python
  OffsetQuery = Annotated[int, Query(ge=0)]
  LimitQuery = Annotated[int, Query(ge=1, le=100)]
  ```

- Defaults are set at the call site, never inside `Annotated`, and they are the
  same two values in **every** list endpoint:

  ```python
  offset: OffsetQuery = 0,
  limit: LimitQuery = settings.items_per_user,
  ```

- **A collection read answers `Page[...]`, never a bare `list[...]`.** The
  envelope carries `items` and `total` (`app/core/page.py`), so a client can
  say "1–10 of 240" on the first page instead of learning the number on the
  last. An array can only be probed — ask for one row more than fits and infer
  "there is another page" — which is not a count.
- **Every collection read is paginated — no exceptions.** A
  sub-collection (`GET /{project_id}/endpoints`, `GET /{project_id}/logs`) is a
  collection: "the foreign key keeps it small" is an assumption about data, not
  a bound in the code, and a mock polled in a loop fills the log table fast.
  Symmetry is the point: a caller pages the same way everywhere, and a reviewer
  never has to ask which endpoints are special.
- **The page size has one source: `settings.items_per_user`.** A literal default
  (`limit: LimitQuery = 100`) is a second page size that no environment can
  change and that drifts from the rest of the API.
- **`ITEMS_PER_USER` ≤ the `le=` cap.** It is the default of every list
  endpoint, so a configured page size above the cap makes every unpaginated call
  answer 422. Checked against both `.env` files.
- Pagination flows through the layers unchanged: router
  (`offset`/`limit` aliases) → service (`offset: int = 0, limit: int = 100`) →
  repository (`.offset(offset).limit(limit)`). A router that accepts pagination
  and drops it before the query is worse than none: the caller is told it worked.
- **A grid's list sorts on the server.** Every top-level collection read (a
  `Page[...]` whose path names no `{id}` - the one the project list page
  pages) declares the sorted column and its direction after the filters:

  ```python
  sort: ProjectSortQuery = None,
  order: OrderQuery = "asc",
  ```

  `OrderQuery` is one closed pair. `<Domain>SortQuery` is one alias per list, a
  `Literal` of the columns the grid may sort (`ProjectSortQuery` is
  `Literal["name", "slug", "created_at"]`) - closed, because a `sort` open
  to any string is one `getattr` away from a 500, and `None` is the endpoint's
  own order, the one it paged by before sorting existed. The pair flows through
  the layers like pagination and lands in `app/core/sorting.ordered`, which puts
  the named column first and the endpoint's own order after it as the tiebreak
  (a page cut through a run of equal values must land on the same rows twice).
  Without it every grid header sorts the loaded rows and calls it the
  collection. `check-backend-router-params` demands the pair on every such
  endpoint, that both reach the service call, and that every `Literal` member is
  a mapped column of a model (or a key a repository declares as
  `<KEY>_SORT = "<key>"`). A sub-collection (the endpoints and logs tabs of the
  project detail dialog) is read without sortable headers and stays unsorted.
- Routers never declare their own `Annotated` alias, and never call `Query()`,
  `Depends()`, `Path()`, `Body()` or `Header()` inline — the alias is the single
  place a parameter's validation lives.

## Never Do These

- Name a path parameter in the route template but not in the signature
- Type an id path parameter as `str` or `int`
- Give a path parameter a default
- Accept `dict`, `Any`, or a bare `int`/`str` query parameter instead of an alias
- Take two body parameters, or name the body anything but `data`
- Put a body on `GET`/`DELETE`
- Ship any `Page[...]` endpoint without `offset`/`limit`, sub-collection included
- Ship a top-level `Page[...]` endpoint without `sort`/`order`, or open `sort` to a bare `str`
- Return a bare `list[...]` from a read — the total is part of the answer
- Default `limit` to a literal instead of `settings.items_per_user`
- Accept `offset`/`limit` in a router and not pass them to the query
- Raise `ITEMS_PER_USER` above the `LimitQuery` cap
- Declare a pagination alias inside a router, or call `Query()` inline
