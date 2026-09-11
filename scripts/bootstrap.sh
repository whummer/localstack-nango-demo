#!/usr/bin/env bash
# Register the demo provider configs and one connection each on the local Nango
# server, via the Nango REST API. Idempotent: re-running it is safe.
#
# Each provider's auth mode is read from Nango's own GET /providers/<name>
# instead of being hardcoded, since that's the one place it's guaranteed
# accurate. Two providers (twilio, resend) define a live "verification"
# endpoint against the *real* API for their auth mode (BASIC / API_KEY) - the
# LocalStack twins don't accept real credentials for it to succeed against,
# so those two providers deploy fine but never get a working connection here.
# That's a Nango security feature (it always verifies API_KEY/BASIC
# credentials live), not a bug in this script - see README's Known gaps.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

NANGO="${NANGO_HOSTPORT:-http://localhost:3003}"

# provider_config_key | Nango provider slug | emulator base URL
integrations=(
  "github|github|http://github.localhost.localstack.cloud:4566"
  "stripe|stripe|http://stripe.localhost.localstack.cloud:4566"
  "twilio|twilio|http://twilio.localhost.localstack.cloud:4566"
  "hubspot|hubspot|http://hubspot.localhost.localstack.cloud:4566"
  "linear|linear|http://linear.localhost.localstack.cloud:4566"
  "shopify|shopify|http://shopify.localhost.localstack.cloud:4566"
  "slack|slack|http://slack.localhost.localstack.cloud:4566"
  "resend|resend|http://resend.localhost.localstack.cloud:4566"
  "posthog|posthog|http://posthog.localhost.localstack.cloud:4566"
  "logodev|unauthenticated|http://logo.dev.localhost.localstack.cloud:4566"
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
    ${3:+-d "$3"}
  echo " $(cat /tmp/nango-api.out)"
}

auth_mode_for() {
  curl -sS "${NANGO}/providers/$1" -H "Authorization: Bearer ${KEY}" |
    python3 -c 'import sys,json; print(json.load(sys.stdin).get("data",{}).get("auth_mode",""))' 2>/dev/null
}

for entry in "${integrations[@]}"; do
  IFS='|' read -r key provider base <<<"$entry"
  mode="$(auth_mode_for "$provider")"
  log "integration '${key}' (provider '${provider}', auth ${mode:-unknown}) -> ${base}"

  case "$mode" in
    OAUTH2)
      int_creds='{"type":"OAUTH2","client_id":"emulator","client_secret":"emulator","scopes":""}'
      conn_creds='{"type":"OAUTH2","access_token":"emulator-token"}'
      ;;
    API_KEY)
      int_creds=""
      case "$key" in
        resend) conn_creds='{"type":"API_KEY","apiKey":"re_emulator_0000000000000000000"}' ;;
        posthog) conn_creds='{"type":"API_KEY","apiKey":"phx_emulator0000000000000000000"}' ;;
        *) conn_creds='{"type":"API_KEY","apiKey":"emulator-key"}' ;;
      esac
      ;;
    BASIC)
      int_creds=""
      conn_creds='{"type":"BASIC","username":"AC00000000000000000000000000demo","password":"emulator-token"}'
      ;;
    NONE)
      int_creds=""
      conn_creds='{"type":"NONE"}'
      ;;
    *)
      warn "  unknown/unavailable auth mode for provider '${provider}' - skipping"
      continue
      ;;
  esac

  res="$(api POST /integrations "{\"provider\":\"${provider}\",\"unique_key\":\"${key}\"${int_creds:+,\"credentials\":${int_creds}}}")"
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
    *"connection_test_failed"*) warn "  connection 'demo' failed Nango's live credential check (expected for ${mode} providers against fake creds - see README)" ;;
    *) warn "  POST /connections -> $res" ;;
  esac
done

log "bootstrap complete"
