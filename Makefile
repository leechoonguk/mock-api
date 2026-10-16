.PHONY: help install dev down clean migrate hook-report verify commit push check-backend-model-files check-backend-repository-files check-backend-service-injection check-backend-layout check-backend-exceptions check-backend-router-params check-backend-naming check-backend-transaction check-backend-tests check-backend-middleware check-backend-app-setup check-backend-core-config check-duplicate-blocks check-code-layout check-tooling check-frontend-code check-frontend-layout check-frontend-domain check-frontend-api-layer check-frontend-routing check-frontend-i18n check-omp-types check-makefiles check-verify

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-32s\033[0m %s\n", $$1, $$2}'

install: ## Install backend (uv sync) and frontend (npm install) dependencies
	$(MAKE) -C backend install
	$(MAKE) -C frontend install

dev: ## Start backend (127.0.0.1:47821) and frontend (Vite :47823) in the background
	$(MAKE) -C backend dev
	$(MAKE) -C frontend dev

down: ## Stop the backend and frontend dev servers
	$(MAKE) -C backend down
	$(MAKE) -C frontend down

clean: ## Remove backend and frontend caches
	$(MAKE) -C backend clean
	$(MAKE) -C frontend clean

migrate: ## Apply Alembic migrations to the local SQLite database
	$(MAKE) -C backend migrate

hook-report: ## Report what the post hooks actually cost and which never warned
	node .omp/hooks/lib/hook-metrics.ts

check-backend-model-files: ## Check model files (one table, one class, one file)
	node .omp/hooks/post/check-backend-model-files.ts

check-backend-repository-files: ## Check repository files (one repository, one table, named after it)
	node .omp/hooks/post/check-backend-repository-files.ts

check-backend-service-injection: ## Check no service injects another service
	node .omp/hooks/post/check-backend-service-injection.ts

check-backend-layout: ## Check the backend directory charter (declared directories, module names, import direction)
	node .omp/hooks/post/check-backend-layout.ts

check-backend-exceptions: ## Check core exception policy (raise only core exceptions)
	node .omp/hooks/post/check-backend-exceptions.ts

check-backend-router-params: ## Check backend router parameter standard (path/body/dep/query)
	node .omp/hooks/post/check-backend-router-params.ts

check-backend-naming: ## Check backend naming conventions
	node .omp/hooks/post/check-backend-naming.ts

check-backend-transaction: ## Check backend transaction conventions
	node .omp/hooks/post/check-backend-transaction.ts

check-backend-tests: ## Check backend test standard (mirrored test tree, 9 API cases, conftest)
	node .omp/hooks/post/check-backend-tests.ts

check-backend-middleware: ## Check backend middleware (CORS, CSRF, security headers, request ID, logging)
	node .omp/hooks/post/check-backend-middleware.ts

check-backend-app-setup: ## Check backend app setup (health, OpenAPI metadata, /api/v1, unversioned mock)
	node .omp/hooks/post/check-backend-app-setup.ts

check-backend-core-config: ## Check backend core config (settings validators, DB pool, error schema)
	node .omp/hooks/post/check-backend-core-config.ts

check-duplicate-blocks: ## Check for duplicated block runs (stale rewrite + partial edits)
	node .omp/hooks/post/check-duplicate-blocks.ts

check-code-layout: ## Check code layout (comments, banners, constants, member order)
	node .omp/hooks/post/check-code-layout.ts

check-tooling: ## Check tooling language policy (TypeScript hooks, no Python scripts)
	node .omp/hooks/post/check-tooling.ts

check-frontend-code: ## Check frontend code conventions
	node .omp/hooks/post/check-frontend-code.ts

check-frontend-layout: ## Check the frontend directory charter (declared entries, file names, import direction, no component cycle)
	node .omp/hooks/post/check-frontend-layout.ts

check-frontend-domain: ## Check the frontend 6-layer domain pattern (child and read-only domains included)
	node .omp/hooks/post/check-frontend-domain.ts

check-frontend-api-layer: ## Check the frontend API layer (one client, keys, invalidation)
	node .omp/hooks/post/check-frontend-api-layer.ts

check-frontend-routing: ## Check paths ↔ routes ↔ navigation and the catch-all inside the shell
	node .omp/hooks/post/check-frontend-routing.ts

check-frontend-i18n: ## Check locale parity, referenced keys and hardcoded text
	node .omp/hooks/post/check-frontend-i18n.ts

check-omp-types: ## Type-check the harness TypeScript (.omp/**/*.ts)
	node .omp/hooks/post/check-omp-types.ts

check-makefiles: ## Check Makefile targets consistency
	node .omp/hooks/post/check-makefiles.ts

check-verify: ## Run backend + frontend verify (lint, typecheck, test/build)
	node .omp/hooks/post/check-verify.ts

commit: verify ## Commit the verified worktree (usage: make commit m="type(scope): subject" | make commit f=path/to/message)
	@test -n '$(m)$(f)' || { echo 'usage: make commit m="type(scope): subject" | make commit f=<message file>' >&2; exit 2; }
	@test -z '$(m)' -o -z '$(f)' || { echo 'usage: pass m= or f=, not both' >&2; exit 2; }
	@test -z '$(f)' -o -f '$(f)' || { echo 'no such message file: $(f)' >&2; exit 2; }
	@git add -A
	@$(if $(f),git commit -q -F '$(f)',git commit -q -m '$(m)')
	@git --no-pager log --oneline -1

push: verify ## Push the current branch after the gate passes
	@git push origin "$$(git rev-parse --abbrev-ref HEAD)"
	@git --no-pager log --oneline -1 "origin/$$(git rev-parse --abbrev-ref HEAD)"

verify: check-backend-model-files check-backend-repository-files check-backend-service-injection check-backend-layout check-backend-exceptions check-backend-router-params check-backend-naming check-backend-transaction check-backend-tests check-backend-middleware check-backend-app-setup check-backend-core-config check-duplicate-blocks check-code-layout check-tooling check-frontend-code check-frontend-layout check-frontend-domain check-frontend-api-layer check-frontend-routing check-frontend-i18n check-omp-types check-makefiles check-verify ## Run all OMP hooks + backend + frontend verify
