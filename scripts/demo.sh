#!/usr/bin/env bash
# Read/write the emulators through the Nango proxy, proving the loop end to end:
# client -> Nango proxy -> LocalStack Application Emulator -> response.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

NANGO="${NANGO_HOSTPORT:-http://localhost:3003}"
KEY="$(nango_secret_key)"
[[ -n "$KEY" ]] || die "could not resolve the Nango dev secret key"

# proxy <method> <provider_config_key> <base_url> <path> [extra curl args...]
proxy() {
  local method=$1 key=$2 base=$3 path=$4
  shift 4
  curl -sS -X "$method" "${NANGO}/proxy${path}" \
    -H "Authorization: Bearer ${KEY}" \
    -H "Provider-Config-Key: ${key}" \
    -H "Connection-Id: demo" \
    -H "Base-Url-Override: ${base}" \
    "$@"
}

pretty() { command -v jq >/dev/null 2>&1 && jq "$@" || cat; }

log "GitHub repos"
proxy GET github http://github.localhost.localstack.cloud:4566 "/user/repos" |
  pretty '.[]? | {id, full_name}'

log "Stripe customers"
proxy GET stripe http://stripe.localhost.localstack.cloud:4566 "/v1/customers?limit=10" |
  pretty '.data[]? | {id, email, name}'

log "Twilio messages"
proxy GET twilio http://twilio.localhost.localstack.cloud:4566 \
  "/2010-04-01/Accounts/AC00000000000000000000000000demo/Messages.json" |
  pretty '.messages[]? | {sid, to, body}'

log "HubSpot contacts"
proxy GET hubspot http://hubspot.localhost.localstack.cloud:4566 \
  "/crm/v3/objects/contacts?properties=email,firstname,lastname&limit=10" |
  pretty '.results[]? | {id, properties}'

log "Linear issues (GraphQL)"
proxy POST linear http://linear.localhost.localstack.cloud:4566 "/graphql" \
  -H "Content-Type: application/json" \
  -d '{"query":"query { issues(first: 10) { nodes { id title state { name } } } }"}' |
  pretty '.data.issues.nodes[]?'

log "Shopify products"
proxy GET shopify http://shopify.localhost.localstack.cloud:4566 "/admin/api/2024-01/products.json" |
  pretty '.products[]? | {id, title, vendor}'

log "Slack channels"
proxy GET slack http://slack.localhost.localstack.cloud:4566 "/api/conversations.list" |
  pretty '.channels[]? | {id, name}'

log "PostHog: capture an event"
proxy POST posthog http://posthog.localhost.localstack.cloud:4566 "/capture/" \
  -H "Content-Type: application/json" \
  -d '{"api_key":"phx_emulator0000000000000000000","event":"demo_event","distinct_id":"demo-user","properties":{"source":"localstack-nango-demo"}}' |
  pretty '.'

log "Resend: send an email"
proxy POST resend http://resend.localhost.localstack.cloud:4566 "/emails" \
  -H "Content-Type: application/json" \
  -d '{"from":"demo@localstack-nango-demo.dev","to":"ada@example.com","subject":"Hi","text":"From the local dev loop"}' |
  pretty '.'

log "logo.dev: fetch a logo"
# ?token=... (the real API's own convention), not an Authorization header:
# that header authenticates this call to Nango itself, so a second
# Authorization value here would collide with it instead of reaching the
# emulator.
proxy GET logodev http://logodev.localhost.localstack.cloud:4566 \
  "/stripe.com?token=pk_emulator_0000000000000000000" \
  -o /dev/null -w '  HTTP %{http_code}, content-type %{content_type}\n'

log "demo complete"
