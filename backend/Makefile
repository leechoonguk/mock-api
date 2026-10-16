.PHONY: help install dev down clean migrate migrate-down migrate-gen migrate-check verify test test-fast fix lint typecheck

UV := uv

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (uv sync)
	$(UV) sync

# The host port comes from the root .env (BACKEND_PORT); start.sh reads it.
BACKEND_PORT ?= $(shell sed -n 's/^BACKEND_PORT[[:space:]]*=[[:space:]]*\([0-9]*\).*/\1/p' ../.env 2>/dev/null || true)
BACKEND_PORT := $(if $(BACKEND_PORT),$(BACKEND_PORT),47821)

dev: ## Run backend locally (migrate + uvicorn on 127.0.0.1:BACKEND_PORT, reload)
	ENV=local BACKEND_PORT=$(BACKEND_PORT) ./scripts/start.sh

down: ## Stop backend (kill the listener on BACKEND_PORT)
	-lsof -ti:$(BACKEND_PORT) | xargs -r kill -9 2>/dev/null; echo "==> stopped :$(BACKEND_PORT)"

clean: ## Remove test, lint, coverage, and Python caches
	rm -rf .coverage .coverage.* .pytest_cache .ruff_cache cov_html htmlcov
	find . -path ./.venv -prune -o -type d -name __pycache__ -prune -exec rm -rf {} +

migrate: ## Apply alembic migrations to head
	mkdir -p data
	.venv/bin/alembic upgrade head

migrate-down: ## Roll back the most recent migration (alembic downgrade -1)
	.venv/bin/alembic downgrade -1

migrate-gen: ## Generate a new migration from model changes (usage: make migrate-gen m="msg")
	@test -n "$(strip $(m))" || { echo 'ERROR: non-empty m="<message>" is required - the message becomes the filename slug'; exit 1; }
	@mkdir -p data
	@next=$$(($(shell ls alembic/versions/[0-9]*_*.py 2>/dev/null | xargs -r -L1 basename 2>/dev/null | cut -d_ -f1 | sort -n | tail -1) + 1)); \
		echo "==> new migration rev: $$next"; \
		.venv/bin/alembic revision --autogenerate --rev-id $$next -m "$(m)"

# A throwaway file database, so the check proves the revisions build the models'
# schema from nothing without touching the developer's data.
migrate-check: ## Upgrade a scratch SQLite DB to head and fail if the models drift from the migrations
	@db=$$(mktemp -d)/migrate-check.db; \
		DATABASE_URL="sqlite+aiosqlite:///$$db" .venv/bin/alembic upgrade head && \
		DATABASE_URL="sqlite+aiosqlite:///$$db" .venv/bin/alembic check; \
		status=$$?; rm -rf "$$(dirname $$db)"; exit $$status

verify: lint typecheck test migrate-check ## Run lint, typecheck, test, and migrate-check (fail-fast)

test: ## Run tests (pytest, xdist workers, 100% coverage gate)
	.venv/bin/pytest -q -n auto

test-fast: ## Run tests without the coverage gate (usage: make test-fast t="tests/api/test_x.py")
	.venv/bin/pytest -q --no-cov $(t)

fix: ## Auto-fix lint and formatting (ruff --fix + format; alembic excluded - migrations are immutable)
	.venv/bin/ruff check --fix app tests
	.venv/bin/ruff format app tests

lint: ## Lint (ruff)
	.venv/bin/ruff check app alembic tests

typecheck: ## Type-check (pyright)
	.venv/bin/pyright
