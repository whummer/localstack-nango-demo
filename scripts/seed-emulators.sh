#!/usr/bin/env bash
# Create sample records directly in the LocalStack Application Emulators, using
# each vendor's real API shape. Safe to run more than once. Emulator endpoint
# coverage varies (this feature is undocumented/evolving), so each call
# prints its status instead of failing the script.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

GITHUB=http://github.localhost.localstack.cloud:4566
STRIPE=http://stripe.localhost.localstack.cloud:4566
TWILIO=http://twilio.localhost.localstack.cloud:4566
HUBSPOT=http://hubspot.localhost.localstack.cloud:4566
SHOPIFY=http://shopify.localhost.localstack.cloud:4566
SLACK=http://slack.localhost.localstack.cloud:4566
POSTHOG=http://posthog.localhost.localstack.cloud:4566
TWILIO_ACCOUNT_SID="AC00000000000000000000000000demo"

# req <label> <curl args...>
req() {
  local label=$1
  shift
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$@")"
  log "  ${label}: HTTP ${code}"
}

log "GitHub: repos"
req "create repo" -X POST "${GITHUB}/user/repos" \
  -H "Authorization: Bearer emulator-token" -H "Content-Type: application/json" \
  -d '{"name":"demo-repo"}'

log "Stripe: customers"
for row in "ada@example.com|Ada Lovelace" "grace@example.com|Grace Hopper"; do
  IFS='|' read -r email name <<<"$row"
  req "create customer (${email})" -X POST "${STRIPE}/v1/customers" \
    -H "Authorization: Bearer sk_test_emulator" \
    --data-urlencode "email=${email}" --data-urlencode "name=${name}"
done

log "Twilio: messages"
req "create message" -X POST "${TWILIO}/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json" \
  -u "${TWILIO_ACCOUNT_SID}:emulator-token" \
  --data-urlencode "To=+15551234567" --data-urlencode "From=+15559876543" \
  --data-urlencode "Body=Hello from the local dev loop"

log "HubSpot: contacts"
for row in "ada@example.com|Ada|Lovelace" "grace@example.com|Grace|Hopper"; do
  IFS='|' read -r email first last <<<"$row"
  req "create contact (${email})" -X POST "${HUBSPOT}/crm/v3/objects/contacts" \
    -H "Authorization: Bearer emulator-token" -H "Content-Type: application/json" \
    -d "{\"properties\":{\"email\":\"${email}\",\"firstname\":\"${first}\",\"lastname\":\"${last}\"}}"
done

log "Shopify: products"
req "create product" -X POST "${SHOPIFY}/admin/api/2024-01/products.json" \
  -H "X-Shopify-Access-Token: emulator-token" -H "Content-Type: application/json" \
  -d '{"product":{"title":"Demo Widget","vendor":"Acme"}}'

log "Slack: channels"
req "create channel" -X POST "${SLACK}/api/conversations.create" \
  -H "Authorization: Bearer xoxb-emulator-token" -H "Content-Type: application/json" \
  -d '{"name":"demo-channel"}'

log "PostHog: capture an event"
req "capture event" -X POST "${POSTHOG}/capture/" \
  -H "Content-Type: application/json" \
  -d '{"api_key":"phx_emulator0000000000000000000","event":"demo_seed","distinct_id":"demo-user"}'

log "seed complete"
log "  github/hubspot/shopify/slack have no LocalStack emulator yet (see README Known gaps) -"
log "  these calls are expected to come back 404/not-found."
log "  Linear/Resend/logodev have no separate seed step: Linear is read via a fixed GraphQL"
log "  query, Resend/logodev are exercised as actions in make demo / the tests."
