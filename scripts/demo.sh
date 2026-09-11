#!/usr/bin/env bash
# Read the seeded records back through the Nango proxy, proving the loop:
# client -> Nango proxy -> LocalStack app emulator -> response.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

NANGO=${NANGO_HOSTPORT:-http://localhost:3003}
SECRET=${NANGO_SECRET_KEY:-nango-demo-secret-key}

# proxy <provider_config_key> <base_url> <path> [extra curl args...]
proxy() {
  local key=$1 base=$2 path=$3
  shift 3
  curl -sS "${NANGO}/proxy${path}" \
    -H "Authorization: Bearer ${SECRET}" \
    -H "Provider-Config-Key: ${key}" \
    -H "Connection-Id: demo" \
    -H "Base-Url-Override: ${base}" \
    "$@"
}

pretty() { command -v jq >/dev/null 2>&1 && jq "$@" || cat; }

log "Stripe customers via Nango proxy"
proxy stripe http://stripe.localhost.localstack.cloud:4566 "/v1/customers?limit=10" |
  pretty '.data[]? | {id, email, name}'

log "Xero invoices via Nango proxy"
proxy xero http://xero.localhost.localstack.cloud:4566 "/api.xro/2.0/Invoices" \
  -H "Xero-Tenant-Id: demo-tenant" |
  pretty '.Invoices[]? | {InvoiceNumber, Status, Total}'

log "HubSpot contacts via Nango proxy"
proxy hubspot http://hubspot.localhost.localstack.cloud:4566 \
  "/crm/v3/objects/contacts?properties=email,firstname,lastname&limit=10" |
  pretty '.results[]? | {id, properties}'

log "demo complete"
