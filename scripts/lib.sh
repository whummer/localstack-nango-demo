#!/usr/bin/env bash
# Shared helpers. Source this file, or run `scripts/lib.sh <function> [args...]`.
set -euo pipefail

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

# Dispatch when executed directly rather than sourced.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd=${1:-}
  [[ -n "$cmd" ]] || die "usage: $(basename "$0") <function> [args...]"
  shift
  "$cmd" "$@"
fi
