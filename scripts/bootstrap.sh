#!/usr/bin/env bash
# Register the demo provider configs and one connection each on the local Nango
# server, via the Nango REST API. Idempotent: re-running it is safe.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

NANGO="${NANGO_HOSTPORT:-http://localhost:3003}"

# provider_config_key | Nango provider slug | emulator base URL
integrations=(
  "stripe|stripe|http://stripe.localhost.localstack.cloud:4566"
  "xero|xero|http://xero.localhost.localstack.cloud:4566"
  "hubspot|hubspot|http://hubspot.localhost.localstack.cloud:4566"
)

wait_for "${NANGO}/health" "Nango server"
KEY="$(nango_secret_key)"
[[ -n "$KEY" ]] || die "could not resolve the Nango dev secret key"
log "using Nango dev secret key ${KEY:0:8}…"

# api <method> <path> <json-body>  -> prints "<http_code> <body>"
api() {
  curl -sS -o /tmp/nango-api.out -w '%{http_code}' -X "$1" "${NANGO}$2" \
    -H "Authorization: Bearer ${KEY}" \
    -H "Content-Type: application/json" \
    -d "$3"
  echo " $(cat /tmp/nango-api.out)"
}

for entry in "${integrations[@]}"; do
  IFS='|' read -r key provider base <<<"$entry"
  log "integration '${key}' (provider '${provider}') -> ${base}"

  # Provider config. Dummy OAuth client: the emulators do not verify it.
  res="$(api POST /integrations \
    "{\"provider\":\"${provider}\",\"unique_key\":\"${key}\",\"credentials\":{\"type\":\"OAUTH2\",\"client_id\":\"emulator\",\"client_secret\":\"emulator\",\"scopes\":\"\"}}")"
  case "$res" in
    2*) log "  provider config created" ;;
    *"already exists"*) log "  provider config already exists" ;;
    *) warn "  POST /integrations -> $res" ;;
  esac

  # A connection with a throwaway bearer token (again, not verified locally).
  res="$(api POST /connections \
    "{\"connection_id\":\"demo\",\"provider_config_key\":\"${key}\",\"credentials\":{\"type\":\"OAUTH2\",\"access_token\":\"emulator-token\"}}")"
  case "$res" in
    2*) log "  connection 'demo' created" ;;
    *) warn "  POST /connections -> $res" ;;
  esac
done

log "bootstrap complete"
