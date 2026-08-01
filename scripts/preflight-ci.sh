#!/usr/bin/env bash
# Local gate so Quality Gate can pass on the first remote run.
#
# Pillar 1 — correctness before push (default pre-push uses "push" tier):
#   Fail locally; do not use GitHub as the debugger.
# Pillar 2 — CI stays lean (path filters + parallel coverage); this script
#   mirrors the *checks*, not the *runtime cost model* of every OS job.
#
# Tiers:
#   push   static + unit + component + plugin-index
#          Default pre-push. Catches almost all reds that used to burn CI cycles.
#   merge  push + integration + build
#   ci     static + plugin-index + test:coverage + build
#          Same shape as Ubuntu static/coverage/build jobs (incl. coverage floors).
#   full   ci + native (Darwin only; --skip-native to omit)
#
# Env:
#   PIER_PREFLIGHT_SKIP_PLUGIN_INDEX=1  skip plugins pack/verify
#
#   pnpm preflight:push | preflight:merge | preflight:ci | preflight:full
#   PIER_PREFLIGHT=ci git push
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

tier="push"
skip_native=0
for arg in "$@"; do
  case "$arg" in
    push | merge | ci | full) tier="$arg" ;;
    --skip-native) skip_native=1 ;;
    -h | --help)
      sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "preflight-ci: unknown argument: $arg" >&2
      echo "usage: $0 [push|merge|ci|full] [--skip-native]" >&2
      exit 2
      ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
run() {
  log "$*"
  # shellcheck disable=SC2086
  eval "$@"
}

elapsed_start=$(date +%s)
finish() {
  local end code=$?
  end=$(date +%s)
  printf '\npreflight-ci [%s] finished in %ss (exit %s)\n' "$tier" "$((end - elapsed_start))" "$code"
  exit "$code"
}
trap finish EXIT

log "preflight-ci tier=${tier} (correctness gate before remote CI)"

run_static() {
  run "pnpm check:static"
  if [[ "${PIER_PREFLIGHT_SKIP_PLUGIN_INDEX:-}" != "1" ]]; then
    run "pnpm check:plugin-index"
  else
    log "skip check:plugin-index (PIER_PREFLIGHT_SKIP_PLUGIN_INDEX=1)"
  fi
}

run_fast_tests() {
  # Cap workers locally: full-core parallel unit thrashing tmp FS makes
  # project-skills (renamex/symlink) and similar suites flake with false
  # timeouts / EXDEV races. CI keeps default parallelism for wall-clock.
  local workers="${PIER_PREFLIGHT_MAX_WORKERS:-4}"
  run "pnpm exec vitest run tests/unit --maxWorkers=${workers}"
  run "pnpm exec vitest run tests/component --maxWorkers=${workers}"
}

# --- push: default pre-push; must catch common CI unit/static failures ---
run_static
run_fast_tests

if [[ "$tier" == "push" ]]; then
  exit 0
fi

# --- merge: + integration + build ---
if [[ "$tier" == "merge" ]]; then
  run "pnpm test:integration"
  run "pnpm build"
  exit 0
fi

# --- ci / full: coverage job shape (thresholds) + build ---
# Re-run unit/component under coverage; integration is included by test:coverage include.
run "pnpm test:coverage"
run "pnpm build"

if [[ "$tier" == "full" && "$skip_native" -eq 0 ]]; then
  if [[ "$(uname -s)" != "Darwin" ]]; then
    log "skip native (not macOS)"
  else
    run "pnpm test:native"
    run "pnpm build:native"
  fi
elif [[ "$tier" == "full" ]]; then
  log "skip native (--skip-native)"
fi

exit 0
