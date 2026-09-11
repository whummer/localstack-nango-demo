#!/usr/bin/env bash
# Register the demo integrations and one connection each on the local Nango
# server. Idempotent: re-running it is safe, "already exists" responses are
# treated as success.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

NANGO=${NANGO_HOSTPORT:-http://localhost:3003}
SECRET=${NANGO_SECRET_KEY:-nango-demo-secret-key}

# provider_config_key | nango provider | emulator base URL
integrations=(
  "stripe|stripe|http://stripe.localhost.localstack.cloud:4566"
  "xero|xero|http://xero.localhost.localstack.cloud:4566"
  "hubspot|hubspot|http://hubspot.localhost.localstack.cloud:4566"
)

api() {
  local method=$1 path=$2 body=${3:-}
  local args=(-sS -o /dev/null -w '%{http_code}' -X "$method" "${NANGO}${path}"
    -H "Authorization: Bearer ${SECRET}"
    -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(-d "$body")
  curl "${args[@]}"
}

wait_for "${NANGO}/health" "Nango server"

for entry in "${integrations[@]}"; do
  IFS='|' read -r key provider base <<<"$entry"
  log "integration '${key}' (provider '${provider}') -> ${base}"

  # Create the integration. Try the current API, fall back to the legacy route.
  api POST /integrations "{\"provider\":\"${provider}\",\"unique_key\":\"${key}\"}" >/dev/null 2>&1 ||
    api POST /config "{\"provider\":\"${provider}\",\"provider_config_key\":\"${key}\",\"oauth_client_id\":\"emulator\",\"oauth_client_secret\":\"emulator\"}" >/dev/null 2>&1 ||
    warn "  create integration returned non-2xx (probably already exists)"

  # Best effort: pin the proxy target for syncs. demo.sh and the tests also
  # send Base-Url-Override, so the loop works even if this route is unsupported.
  api PATCH "/integrations/${key}" "{\"base_url\":\"${base}\"}" >/dev/null 2>&1 ||
    warn "  could not set base_url; relying on Base-Url-Override header"

  # A throwaway connection. The emulators do not verify credentials.
  api POST /connections "{\"connection_id\":\"demo\",\"provider_config_key\":\"${key}\",\"credentials\":{\"type\":\"OAUTH2\",\"access_token\":\"emulator-token\",\"raw\":{}}}" >/dev/null 2>&1 ||
    warn "  create connection returned non-2xx (probably already exists)"
done

log "bootstrap complete"
