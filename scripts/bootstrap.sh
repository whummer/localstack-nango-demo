#!/usr/bin/env bash
# Register the demo provider configs and one connection each on the local Nango
# server, via the Nango REST API. Idempotent: re-running it is safe. Provider
# slugs for the newer twins (twilio, linear, shopify, slack, resend, posthog,
# logo.dev) are best-effort guesses — LocalStack's Application Twins feature
# is undocumented as of this writing, so some entries may not exist in Nango's
# catalog yet. Failures here are warnings, not hard stops, so working twins
# still get wired up.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

NANGO="${NANGO_HOSTPORT:-http://localhost:3003}"

# provider_config_key | Nango provider slug | auth type | emulator base URL
integrations=(
  "github|github|oauth2|http://github.localhost.localstack.cloud:4566"
  "stripe|stripe|oauth2|http://stripe.localhost.localstack.cloud:4566"
  "twilio|twilio|oauth2|http://twilio.localhost.localstack.cloud:4566"
  "hubspot|hubspot|oauth2|http://hubspot.localhost.localstack.cloud:4566"
  "linear|linear|oauth2|http://linear.localhost.localstack.cloud:4566"
  "shopify|shopify|oauth2|http://shopify.localhost.localstack.cloud:4566"
  "slack|slack|oauth2|http://slack.localhost.localstack.cloud:4566"
  "resend|resend|oauth2|http://resend.localhost.localstack.cloud:4566"
  "posthog|posthog|oauth2|http://posthog.localhost.localstack.cloud:4566"
  "logodev|unauthenticated|none|http://logo.dev.localhost.localstack.cloud:4566"
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
  IFS='|' read -r key provider auth base <<<"$entry"
  log "integration '${key}' (provider '${provider}') -> ${base}"

  if [[ "$auth" == "oauth2" ]]; then
    creds='{"type":"OAUTH2","client_id":"emulator","client_secret":"emulator","scopes":""}'
    conn_creds='{"type":"OAUTH2","access_token":"emulator-token"}'
  else
    creds='{"type":"NONE"}'
    conn_creds='{"type":"NONE"}'
  fi

  res="$(api POST /integrations "{\"provider\":\"${provider}\",\"unique_key\":\"${key}\",\"credentials\":${creds}}")"
  case "$res" in
    2*) log "  provider config created" ;;
    *"already exists"*) log "  provider config already exists" ;;
    *)
      warn "  POST /integrations -> $res"
      warn "  skipping connection for '${key}' (no provider config)"
      continue
      ;;
  esac

  res="$(api POST /connections "{\"connection_id\":\"demo\",\"provider_config_key\":\"${key}\",\"credentials\":${conn_creds}}")"
  case "$res" in
    2*) log "  connection 'demo' created" ;;
    *) warn "  POST /connections -> $res" ;;
  esac
done

log "bootstrap complete"
