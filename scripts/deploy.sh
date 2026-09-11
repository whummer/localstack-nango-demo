#!/usr/bin/env bash
# Deploy the integration scripts to the local self-hosted Nango server.
# Requires `make bootstrap` first (the provider configs must exist).
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

NANGO="${NANGO_HOSTPORT:-http://localhost:3003}"

wait_for "${NANGO}/health" "Nango server"
KEY="$(nango_secret_key)"
[[ -n "$KEY" ]] || die "could not resolve the Nango dev secret key"

cd nango-integrations
NANGO_HOSTPORT="$NANGO" \
  NANGO_SECRET_KEY_DEV="$KEY" \
  NANGO_DEPLOY_AUTO_CONFIRM=true \
  npx nango deploy dev
