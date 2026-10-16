.PHONY: help install dev down clean verify lint typecheck build

NPM := npm

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "   \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (npm install)
	$(NPM) install

# Vite owns its port (vite.config.ts); read it so `down` cannot target another.
FRONTEND_PORT ?= $(shell sed -n 's/^[[:space:]]*port:[[:space:]]*\([0-9]*\).*/\1/p' vite.config.ts 2>/dev/null || true)
FRONTEND_PORT := $(if $(FRONTEND_PORT),$(FRONTEND_PORT),47823)

dev: ## Run Vite dev server (port from vite.config.ts, background)
	nohup npx vite > /tmp/mock-api-frontend.log 2>&1 & echo "==> Frontend PID: $$! (:$(FRONTEND_PORT))"

down: ## Stop frontend (kill Vite on its configured port)
	lsof -ti:$(FRONTEND_PORT) | xargs kill -9 2>/dev/null; echo "==> stopped :$(FRONTEND_PORT)"

clean: ## Remove build, Vite, and TypeScript caches
	rm -rf dist .vite node_modules/.vite *.tsbuildinfo

verify: lint typecheck build ## Run lint, typecheck, and build (fail-fast)

lint: ## Lint (eslint)
	npx eslint .

typecheck: ## Type-check (tsc --noEmit)
	npx tsc --noEmit

build: ## Production build (tsc -b && vite build)
	npx tsc -b && npx vite build
