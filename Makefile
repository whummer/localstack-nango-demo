# localstack-nango-demo
#
# Run `make` (or `make help`) to see every available target.
# Local dev loop:  up -> bootstrap -> deploy -> seed -> sync / demo -> test

SHELL := bash
.SHELLFLAGS := -ec
.DEFAULT_GOAL := help
.ONESHELL:

COMPOSE     ?= docker compose
NANGO_HOST  ?= http://localhost:3003
LOCALSTACK  ?= http://localhost:4566
export COMPOSE

# Load .env if present so targets can see LOCALSTACK_AUTH_TOKEN etc.
ifneq (,$(wildcard .env))
include .env
export
endif

## ─── Stack lifecycle ────────────────────────────────────────────────────────

.PHONY: up
up: check-env ## Start LocalStack and the self-hosted Nango stack
	$(COMPOSE) up -d
	$(MAKE) wait

.PHONY: wait
wait: ## Block until LocalStack and Nango are healthy
	@# 90 tries * 2s = 180s: with 5 Application Emulators enabled, LocalStack's
	@# own startup takes noticeably longer than a bare instance.
	@./scripts/lib.sh wait_for "$(LOCALSTACK)/_localstack/health" "LocalStack" 90
	@./scripts/lib.sh wait_for "$(NANGO_HOST)/health" "Nango server"

.PHONY: down
down: ## Stop the stack and remove containers
	$(COMPOSE) down

.PHONY: clean
clean: ## Stop the stack and delete all volumes and build artifacts
	$(COMPOSE) down -v
	rm -rf volume nango-integrations/build nango-integrations/dist
	find nango-integrations/.nango -type f ! -name .gitkeep -delete 2>/dev/null || true

.PHONY: logs
logs: ## Tail logs from every container (follows)
	$(COMPOSE) logs -f --tail=100

.PHONY: logs-dump
logs-dump: ## Print recent logs once and exit (used by CI)
	$(COMPOSE) logs --tail=200 --no-color

.PHONY: ps
ps: ## Show container status
	$(COMPOSE) ps

## ─── Integration workflow ───────────────────────────────────────────────────

.PHONY: install
install: ## Install the nango-integrations dependencies
	cd nango-integrations && { npm ci --no-audit --no-fund || npm install --no-audit --no-fund; }

.PHONY: compile
compile: install ## Type-check and build the integration scripts (no server needed)
	cd nango-integrations && npx nango compile

.PHONY: bootstrap
bootstrap: ## Register the provider configs and a demo connection on the Nango server
	./scripts/bootstrap.sh

.PHONY: deploy
deploy: install ## Deploy the integration scripts to the local Nango server
	./scripts/deploy.sh

.PHONY: seed
seed: ## Create sample records inside the LocalStack app emulators
	./scripts/seed-emulators.sh

.PHONY: sync
sync: ## Trigger the syncs and report the records Nango stored
	./scripts/run-syncs.sh

.PHONY: demo
demo: ## Read the emulator data back through the Nango proxy
	./scripts/demo.sh

## ─── Testing ────────────────────────────────────────────────────────────────

.PHONY: test
test: ## Run the local dev-loop test suite (node --test)
	NANGO_SECRET_KEY="$$(./scripts/lib.sh nango_secret_key)" node --test tests/

.PHONY: ci
ci: compile up bootstrap deploy seed sync test ## Full loop used by CI

## ─── Helpers ────────────────────────────────────────────────────────────────

.PHONY: nango-key
nango-key: ## Print the self-hosted Nango "dev" environment secret key
	@./scripts/lib.sh nango_secret_key

.PHONY: check-env
check-env: ## Verify .env exists and required variables are set
	@test -f .env || { echo "missing .env (copy .env.example)"; exit 1; }
	@test -n "$(LOCALSTACK_AUTH_TOKEN)" || { echo "LOCALSTACK_AUTH_TOKEN is not set in .env"; exit 1; }
	@test -n "$(NANGO_ENCRYPTION_KEY)" || { echo "NANGO_ENCRYPTION_KEY is not set in .env"; exit 1; }
	@echo "env OK"

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} \
		/^## / {printf "\n\033[1m%s\033[0m\n", substr($$0, 4); next} \
		/^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' \
		$(MAKEFILE_LIST)
	@echo
