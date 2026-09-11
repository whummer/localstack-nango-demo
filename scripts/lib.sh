#!/usr/bin/env bash
# Shared helpers. Source this file, or run `scripts/lib.sh <function> [args...]`.
set -euo pipefail

COMPOSE="${COMPOSE:-docker compose}"

log()  { printf '\033[36m==>\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[33mwarn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# wait_for <url> [name] [tries]
wait_for() {
  local url=$1 name=${2:-$1} tries=${3:-60}
  log "waiting for ${name} ..."
  for ((i = 1; i <= tries; i++)); do
    if curl -sf -o /dev/null "$url"; then
      log "${name} is ready"
      return 0
    fi
    sleep 2
  done
  die "${name} not ready after $((tries * 2))s at ${url}"
}

# Print the self-hosted Nango "dev" environment secret key.
# Uses $NANGO_SECRET_KEY if set, otherwise reads it from the Nango Postgres.
# On a fresh self-hosted server this key is a generated UUID stored in plain text.
nango_secret_key() {
  if [[ -n "${NANGO_SECRET_KEY:-}" ]]; then
    echo "${NANGO_SECRET_KEY}"
    return 0
  fi
  $COMPOSE exec -T nango-db psql -U nango -tAc \
    "select secret_key from _nango_environments where name = 'dev' and deleted = false order by id limit 1" \
    | tr -d '[:space:]'
}

# Dispatch when executed directly rather than sourced.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd=${1:-}
  [[ -n "$cmd" ]] || die "usage: $(basename "$0") <function> [args...]"
  shift
  "$cmd" "$@"
fi
