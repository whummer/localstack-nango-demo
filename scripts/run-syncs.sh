#!/usr/bin/env bash
# Trigger each sync against the `demo` connection and report how many records
# Nango stored. Needs `make deploy` and `make seed` first.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

NANGO="${NANGO_HOSTPORT:-http://localhost:3003}"
KEY="$(nango_secret_key)"
[[ -n "$KEY" ]] || die "could not resolve the Nango dev secret key"

record_count() { # <provider_config_key> <model>
  curl -sS "${NANGO}/records?model=$2" \
    -H "Authorization: Bearer ${KEY}" \
    -H "Connection-Id: demo" \
    -H "Provider-Config-Key: $1" |
    python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("records", [])))'
}

run_sync() { # <provider_config_key> <sync_name> <model>
  local pck=$1 sync=$2 model=$3
  log "triggering ${sync}"
  curl -sS -o /dev/null -X POST "${NANGO}/sync/trigger" \
    -H "Authorization: Bearer ${KEY}" \
    -H "Content-Type: application/json" \
    -H "Connection-Id: demo" \
    -H "Provider-Config-Key: ${pck}" \
    -d "{\"syncs\":[\"${sync}\"]}"

  # Short poll: github/hubspot/linear/shopify/slack have no LocalStack emulator
  # yet (see README Known gaps), so this is diagnostic rather than a real wait.
  for _ in $(seq 1 5); do
    local n
    n="$(record_count "$pck" "$model")"
    if [[ "${n:-0}" -gt 0 ]]; then
      log "  ${model}: ${n} record(s)"
      return 0
    fi
    sleep 2
  done
  warn "  ${model}: no records after 10s (expected: no LocalStack emulator for this provider yet)"
}

run_sync github   github-repos      GithubRepo
run_sync stripe   stripe-customers  StripeCustomer
run_sync twilio   twilio-messages   TwilioMessage
run_sync hubspot  hubspot-contacts  HubSpotContact
run_sync linear   linear-issues     LinearIssue
run_sync shopify  shopify-products  ShopifyProduct
run_sync slack    slack-channels    SlackChannel

log "syncs complete (resend, posthog and logodev are actions, exercised by make demo)"
