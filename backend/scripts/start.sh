#!/usr/bin/env bash
# Run DB migrations then start the backend server.
# ENV=local (default)  → uvicorn with --reload on 127.0.0.1:BACKEND_PORT in the
#                        background. Loopback only: the app has no
#                        authentication, so it must not be reachable from
#                        another machine.
# ENV=production        → uvicorn on 127.0.0.1:BACKEND_PORT in the foreground,
#                        no reload.
# Usage: ./scripts/start.sh
set -euo pipefail

cd "$(dirname "$0")/.."

port="${BACKEND_PORT:-47821}"

# The SQLite file lives in data/ (DATABASE_URL in .env); SQLite creates the
# file, not its directory.
mkdir -p data

echo "==> Applying database migrations"
.venv/bin/alembic upgrade head

# A model column with no revision migrates cleanly and then fails every query
# that selects it. Refuse to serve instead: a backend that never starts names
# its cause, one that serves 500s does not.
echo "==> Checking the models against the migrated schema"
if ! drift=$(.venv/bin/alembic check 2>&1); then
    printf '%s\n' "$drift" | tail -n 5 >&2
    echo "ERROR: the models and the migrations disagree - refusing to serve." >&2
    echo "       Generate the missing revision (make migrate-gen m=\"...\"), then restart." >&2
    exit 1
fi

if [ "${ENV:-local}" = "local" ]; then
    echo "==> Starting backend (uvicorn 127.0.0.1:$port, reload)"
    # Reload watches app/ only: editing a test must not restart the server.
    nohup .venv/bin/uvicorn app.main:app --reload --reload-dir app --timeout-graceful-shutdown 5 \
        --host 127.0.0.1 --port "$port" > /tmp/mock-api-backend.log 2>&1 &
    disown
    echo "==> Backend PID: $! (log: /tmp/mock-api-backend.log)"
else
    echo "==> Starting backend (uvicorn 127.0.0.1:$port, production)"
    # exec replaces the shell so uvicorn receives SIGTERM directly on shutdown.
    exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$port"
fi
