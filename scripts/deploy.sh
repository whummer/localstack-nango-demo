#!/usr/bin/env bash
# Deploy the integration scripts to the local self-hosted Nango server.
# Requires `make bootstrap` first (the provider configs must exist).
#
# Deploys one sync/action at a time rather than the whole batch: a provider
# config that didn't get created (see bootstrap.sh's warnings) would otherwise
# fail the entire deploy, when the real intent is "deploy whatever is wired up".
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

NANGO="${NANGO_HOSTPORT:-http://localhost:3003}"

syncs=(stripe-customers github-repos twilio-messages hubspot-contacts linear-issues shopify-products slack-channels posthog-projects)
actions=(send-email fetch-logo)

wait_for "${NANGO}/health" "Nango server"
KEY="$(nango_secret_key)"
[[ -n "$KEY" ]] || die "could not resolve the Nango dev secret key"

cd nango-integrations
export NANGO_HOSTPORT="$NANGO"
export NANGO_SECRET_KEY_DEV="$KEY"
export NANGO_DEPLOY_AUTO_CONFIRM=true

failed=()

for sync in "${syncs[@]}"; do
  log "deploying sync '${sync}'"
  if npx nango deploy dev --sync "$sync" >/tmp/nango-deploy.out 2>&1; then
    log "  ok"
  else
    warn "  failed (see below)"
    tail -n 5 /tmp/nango-deploy.out | sed 's/^/    /'
    failed+=("$sync")
  fi
done

for action in "${actions[@]}"; do
  log "deploying action '${action}'"
  if npx nango deploy dev --action "$action" >/tmp/nango-deploy.out 2>&1; then
    log "  ok"
  else
    warn "  failed (see below)"
    tail -n 5 /tmp/nango-deploy.out | sed 's/^/    /'
    failed+=("$action")
  fi
done

if [[ ${#failed[@]} -gt 0 ]]; then
  warn "not deployed: ${failed[*]}"
else
  log "all syncs and actions deployed"
fi
