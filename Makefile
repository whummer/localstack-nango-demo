# localstack-nango-demo
#
# Run `make` (or `make help`) to see every available target.
# The local dev loop is: up -> deploy -> bootstrap -> seed -> demo / test -> down

SHELL := bash
.DEFAULT_GOAL := help
.ONESHELL:

COMPOSE     ?= docker compose
NANGO_HOST  ?= http://localhost:3003
LOCALSTACK  ?= http://localhost:4566

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
	@./scripts/lib.sh wait_for "$(LOCALSTACK)/_localstack/health" "LocalStack"
	@./scripts/lib.sh wait_for "$(NANGO_HOST)/health" "Nango server"

.PHONY: down
down: ## Stop the stack and remove containers
	$(COMPOSE) down

.PHONY: clean
clean: ## Stop the stack and delete all volumes and local state
	$(COMPOSE) down -v
	rm -rf volume nango-integrations/dist nango-integrations/.nango

.PHONY: logs
logs: ## Tail logs from every container
	$(COMPOSE) logs -f --tail=100

.PHONY: ps
ps: ## Show container status
	$(COMPOSE) ps

## ─── Integration workflow ───────────────────────────────────────────────────

.PHONY: deploy
deploy: ## Push nango.yaml and the sync scripts to the local Nango server
	cd nango-integrations && npx --yes nango deploy dev --auto-confirm

.PHONY: bootstrap
bootstrap: ## Register the Stripe/Xero/HubSpot integrations and a demo connection each
	./scripts/bootstrap.sh

.PHONY: seed
seed: ## Create sample records inside the LocalStack app emulators
	./scripts/seed-emulators.sh

.PHONY: demo
demo: ## Read the seeded data back through the Nango proxy
	./scripts/demo.sh

## ─── Testing ────────────────────────────────────────────────────────────────

.PHONY: test
test: ## Run the local dev-loop test suite (node --test)
	node --test tests/

.PHONY: ci
ci: up deploy bootstrap seed test ## Full loop used by CI: bring up, wire, seed, test

## ─── Helpers ────────────────────────────────────────────────────────────────

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
