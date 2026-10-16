---
name: mock-setup
description: Create a mock project and its endpoints on the running Mock API server through the admin API, then prove each one answers on /mock/<slug>/... Use when the user asks to add, set up, or seed a mock project, mock endpoints, or fake API responses (e.g. "users API 목 만들어줘", "엔드포인트 추가해줘").
enforced-by: []
---

# Mock Setup

The user describes an API to fake; this skill turns it into a project and
endpoints on the **running** server, and proves every endpoint answers before
reporting. It is data entry through the admin API - never a code change, never
a migration, never a direct database write.

This is a procedure skill: it owns no check of its own. The rules it follows
are the server's own validation (`app/schemas/project.py`,
`app/schemas/endpoint.py`) and the matching rules in the README section
"목 동작 규칙".

## Workflow

### 1. Use the server that is already running

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:47821/health
```

`200` → use it. Anything else → start the stack with `make dev` (backend
`127.0.0.1:47821`, admin UI `http://localhost:47823`) and check again. Never
start a second backend.

### 2. Find or create the project

A project is addressed by its **slug**: `/mock/<slug>/...`. Slug rule:
lower-case letters and digits in words joined by single hyphens
(`^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64). Name 1-120 chars, description
at most 512.

Look before creating - a taken slug is a 409 `conflict`. The list filters by
`name` only, so read the `slug` of every row instead of filtering; when
`total` is over 100, page on with `offset=100`, `200`, ...:

```bash
curl -s 'http://127.0.0.1:47821/api/v1/project/?offset=0&limit=100'
```

- The slug already exists and the user meant that project → reuse its `id`.
- The slug exists but the user meant a new one → ask for another slug; never
  delete or rename the existing project to make room.
- None → create it:

```bash
curl -s -X POST http://127.0.0.1:47821/api/v1/project/ \
  -H 'content-type: application/json' \
  -d '{"name":"Users API","slug":"users-api","description":"..."}'
```

Keep the `id` from the answer.

### 3. Write each endpoint as a payload file

`body` is a **string**, not a JSON object: a JSON response body is
serialized once more inside the payload, so quoting goes wrong fast on a
command line. Write each payload with the `write` tool to
`/tmp/mock-setup/<n>.json` and post the file:

```bash
curl -s -X POST http://127.0.0.1:47821/api/v1/project/<id>/endpoints \
  -H 'content-type: application/json' --data-binary @/tmp/mock-setup/1.json
```

| Field | Rule | Default |
|---|---|---|
| `method` | `GET POST PUT PATCH DELETE HEAD OPTIONS ANY` (`ANY` matches every method) | required |
| `path` | starts with `/`; a segment exactly `{name}` matches any one value; a name at most once; no wildcards or regex; at most 500 | required |
| `status_code` | 100-599 | `200` |
| `headers` | `{"Name": "value"}`; name an HTTP token, value without line breaks | `{}` |
| `body` | string; templates allowed (below) | `""` |
| `delay_ms` | 0-30000 | `0` |
| `enabled` | a disabled endpoint never answers | `true` |
| `description` | at most 512 | `""` |

Body templates (body only - headers and status are sent as written):
`{{path.<name>}}`, `{{query.<name>}}` (first value), `{{headers.<name>}}`
(case-insensitive), `{{body.<a.b.0>}}` (JSON request body, numeric segments
index arrays), `{{now}}` (UTC ISO 8601), `{{uuid}}`. A missing value renders
as an empty string.

Values are inserted **raw**, as text:

- `"id":"{{path.id}}"` answers the string `"42"`; an unquoted
  `"id":{{path.id}}` answers the number `42` but is invalid JSON as soon as
  the value is not a number - keep the quotes unless the user asks for a
  number and only numbers will be sent.
- nothing is escaped: a request value holding `"` breaks a JSON answer
  (`{"title":"say "hi""}`). Tell the user when an echoed field can carry quotes.

Without a `content-type` header the answer is `application/json` when the
rendered body parses as JSON, `text/plain; charset=utf-8` otherwise - set it
explicitly for anything else (XML, HTML). An empty body still gets
`text/plain` - a 204 included.

### 4. Read the answer, not just the status

| Answer | Meaning | Do |
|---|---|---|
| 201 | created | keep the `id` |
| 409 `conflict` | the project already has this method + path | list `GET .../endpoints?offset=0&limit=100`; if the user wants it changed, `PATCH .../endpoints/<endpoint id>` with only the changed fields; otherwise report it as already there |
| 422 | a field broke a rule; `detail[].msg` names it | fix that field and post again - never drop the field to get a 201 |
| 404 `not_found` | wrong project id | re-read step 2 |

Never delete an endpoint or a project you did not create in this run.

### 5. Prove every endpoint on /mock

Only after every POST of step 3 has answered (one at a time, never in
parallel with the proof - an endpoint still being written is a 404), call
each endpoint the way a client would, with concrete values for
its parameters, query and body, and compare status, headers and the rendered
body with what the user asked for:

```bash
curl -s -i 'http://127.0.0.1:47821/mock/<slug>/users/7?page=2' -H 'X-User: kim'
```

Matching to keep in mind when an answer surprises you:

- exact method beats `ANY`; from the left, a literal segment beats `{param}`;
  then the older endpoint wins - `/users/me` and `/users/{id}` coexist.
- paths are normalized (leading `/` added, trailing `/` and `//` collapsed).
- `HEAD` falls back to the `GET` endpoint with an empty body.
- a miss is 404 `mock_not_matched` echoing the method and path asked for; an
  unknown slug is 404 `not_found`.

Every call writes a row to the project's request log; that is expected and
shows the user the calls were made.

### 6. Report

Give the user:

- the admin screen link `http://localhost:47823/project?detail=<project id>&tab=endpoints`
- a table of method, path, status and what each answers
- the curl line for each endpoint, ready to paste, with the answer it gave in step 5

Leave the project in place - the user asked for it. Delete `/tmp/mock-setup/`.

## Never Do These

- Edit backend code, migrations or the database file to add mock data.
- Report an endpoint you did not call on `/mock/<slug>/...`.
- Turn a 409 into a delete-and-recreate without the user asking.
- Send `body` as a JSON object instead of a string.
- Start a second server when one already answers `/health`.
