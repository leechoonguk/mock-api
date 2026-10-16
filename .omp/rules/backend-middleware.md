---
description: Backend middleware — CORS, CSRF protection, security headers, request ID, structured logging, trusted hosts
globs:
      - backend/app/main.py
      - backend/app/core/logging.py
      - backend/tests/api/test_middleware.py
alwaysApply: false
---

# Backend Middleware

## Purpose

Standard middleware stack for the FastAPI app. All middleware is defined and
registered in `main.py` via `app.add_middleware(...)`. The app serves two
audiences through one stack: the admin API (`/api/v1/...`, called by the admin
UI) and the mocks (`/mock/{slug}/{path:path}`, called by whatever app is under
test, from any origin). Each middleware below states how it treats the mocks.

## Required Middleware

### 1. CORS

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,  # default ["*"]
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)
```

- `allow_origins` from settings, default `["*"]`: the mocks exist to be called
  from whatever origin the app under test runs on.
- `allow_credentials=False`: there are no cookies or credentials to share, and
  the CORS spec forbids a credentialed response to a wildcard origin anyway.
- `expose_headers=["*"]`: a mock's configured response headers are part of what
  it answers, so a browser client must be able to read them.

### 2. CSRF Protection

`CsrfProtection` (a `BaseHTTPMiddleware`) validates every unsafe method
(`POST`, `PUT`, `PATCH`, `DELETE`) on the admin API before it reaches a route:

- A present `Origin` must be listed in `settings.csrf_trusted_origins` (the
  admin UI's origins); `*` is never a trusted CSRF origin, so the CORS wildcard
  grants nothing here.
- `Sec-Fetch-Site: cross-site` is rejected unless the request has an explicitly
  trusted Origin. Safe methods (`GET`, `HEAD`, `OPTIONS`) are never blocked.
- Rejections return `403 {"detail": "CSRF validation failed"}` and vary by
  `Origin` and `Sec-Fetch-Site`.
- Requests without browser origin metadata (curl, test clients) pass.
- **Paths under `/mock/` are exempt.** A mock's whole purpose is to accept an
  unsafe request from a foreign origin; protecting it would refuse exactly the
  calls it is configured to answer.

The app has no authentication and no cookies, so no CSRF token is issued: the
Origin check protects the admin API from a foreign page driving the admin
endpoints through a local browser.

### 3. Security Headers

`SecurityHeaders` middleware sets, on every response:

- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`

Each header is written with `response.headers.setdefault(...)`, never by
assignment: a mock endpoint's configured `headers` are part of the answer it was
built to give, and a header the mock declares (its own `X-Frame-Options`, say)
wins over the default.

### 4. Request ID

- Middleware reads the `X-Request-ID` header or generates `uuid4()`
- Sets the response header `X-Request-ID` with `setdefault`, so a mock that
  declares its own `X-Request-ID` answers with it
- Passes the id into the logging context and the error body (`request_id`)

### 5. Structured Logging

- `structlog` configured in `app/core/logging.py`; JSON renderer in production
- Request logging middleware logs method, path, status, duration_ms, request_id
- Never `print()` for application logging
- No secret values in log calls (`logging/secret-in-log.yml`)

## Optional Built-ins (FastAPI)

- `GZipMiddleware` — compress responses > 500B. Not on the mocks' path: a mock
  answers the exact body and headers it was configured with.

## Validation (Post-Hook)

`check-backend-middleware.ts` (`make check-backend-middleware`) verifies in
`main.py` that `TrustedHostMiddleware` takes `settings.allowed_hosts`,
`CORSMiddleware` configures `allow_origins`, `CsrfProtection` reads `Origin` and
`Sec-Fetch-Site` and rejects with `CSRF validation failed`, the
`X-Content-Type-Options` / `X-Frame-Options` / `X-Request-ID` headers are set,
`app/core/logging.py` exists, and each of `TrustedHostMiddleware`,
`CsrfProtection`, `SecurityHeaders`, `CORSMiddleware` is actually registered
with `add_middleware`. It also runs the `logging/` AST rules over `app/`. The
`/mock/` CSRF exemption, `setdefault`, and the CORS arguments beyond
`allow_origins` are conventions (not machine-checked); `backend/tests/api/test_middleware.py`
is where they are pinned.

## Host Allowlist

`TrustedHostMiddleware` takes its list from `settings.allowed_hosts` — never a
literal. A poisoned `Host` header otherwise ends up in anything the app builds
from it (a mock's templated response, a generated URL), and a DNS-rebinding page
could reach the local server under its own name.

`allowed_hosts` is **required** in settings: an allowlist that defaults to
"anything" is the vulnerability it exists to close, so a missing value stops
startup instead of opening the app. An empty list is rejected too — it accepts
nothing, which is a misconfiguration, not a policy.

## Never Do These

- Log with `print()` — use structlog
- Add CORS without `allow_origins` from settings, or with `allow_credentials=True`
- Skip the `X-Request-ID` response header
- Overwrite a header a mock response already carries — use `setdefault`
- Apply CSRF validation to `/mock/` paths
- Treat `CORS_ORIGINS = ["*"]` as a trusted CSRF origin
