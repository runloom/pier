#!/usr/bin/env bash
#
# 把本机 tip（含 dirty 工作区 snapshot）同步到闲置机，并在远端跑 vitest unit。
# 复用 run-e2e.sh 的 SSH / tip / bundle 同步约定。
#
# 用法：
#   bash scripts/e2e-runner/run-unit-remote.sh
#   bash scripts/e2e-runner/run-unit-remote.sh tests/unit/main/adapters/local-control-invoke-socket.test.ts
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "${REPO_ROOT}"

SSH_HOST="${PIER_E2E_SSH_HOST:-pier-e2e}"
REMOTE_DIR="${PIER_E2E_REMOTE_DIR:-pier}"
CONNECT_TIMEOUT="${PIER_E2E_CONNECT_TIMEOUT:-4}"
DEFAULT_REMOTE_PATH="/usr/local/opt/node@24/bin:/opt/homebrew/opt/node@24/bin:/usr/local/opt/zig@0.15/bin:/opt/homebrew/opt/zig@0.15/bin:\${HOME}/.local/bin:\${HOME}/.local-pnpm-e2e/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

info() { printf '\033[1;34m[unit-remote]\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31m[unit-remote]\033[0m %s\n' "$*" >&2; }

remote_ssh() {
  ssh -o BatchMode=yes -o ConnectTimeout="${CONNECT_TIMEOUT}" \
    -o StrictHostKeyChecking=accept-new \
    "${SSH_HOST}" "$@"
}

if ! remote_ssh 'echo ok' >/dev/null 2>&1; then
  err "闲置机不可达: ${SSH_HOST}"
  exit 1
fi

# 解析 tip（dirty → snapshot commit）
head_sha="$(git rev-parse HEAD)"
if [ -z "$(git status --porcelain 2>/dev/null || true)" ]; then
  tip_sha="${head_sha}"
else
  head_tree="$(git rev-parse 'HEAD^{tree}')"
  tmp_index="$(mktemp "${TMPDIR:-/tmp}/pier-unit-index.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -f $(printf %q "${tmp_index}")" EXIT
  GIT_INDEX_FILE="${tmp_index}" git read-tree "${head_sha}"
  GIT_INDEX_FILE="${tmp_index}" git add -A -- .
  tree_sha="$(GIT_INDEX_FILE="${tmp_index}" git write-tree)"
  rm -f "${tmp_index}"
  trap - EXIT
  if [ "${tree_sha}" = "${head_tree}" ]; then
    tip_sha="${head_sha}"
  else
    tip_sha="$(git commit-tree "${tree_sha}" -p "${head_sha}" -m "pier-unit-remote worktree snapshot")"
    info "dirty → snapshot ${tip_sha:0:12}"
  fi
fi

info "同步 tip ${tip_sha:0:12} → ${SSH_HOST}"

remote_abs="$(remote_ssh "export PIER_E2E_REMOTE_DIR=$(printf %q "${REMOTE_DIR}"); bash -s" <<'EOS'
set -euo pipefail
if [[ "${PIER_E2E_REMOTE_DIR}" = /* ]]; then
  printf '%s\n' "${PIER_E2E_REMOTE_DIR}"
else
  printf '%s\n' "${HOME%/}/${PIER_E2E_REMOTE_DIR}"
fi
EOS
)"

if [ -z "${remote_abs}" ]; then
  err "无法解析远端仓库路径"
  exit 1
fi

if ! remote_ssh "test -d $(printf %q "${remote_abs}/.git")"; then
  err "远端不存在 git 仓库: ${remote_abs}"
  exit 1
fi

SYNC_REF="refs/pier-unit-remote/sync"
if ! remote_ssh "git -C $(printf %q "${remote_abs}") cat-file -t $(printf %q "${tip_sha}")" >/dev/null 2>&1; then
  bundle_local="$(mktemp "${TMPDIR:-/tmp}/pier-unit-bundle.XXXXXX.bundle")"
  bundle_remote="/tmp/pier-unit-bundle-${tip_sha:0:12}.bundle"
  # shellcheck disable=SC2064
  trap "rm -f $(printf %q "${bundle_local}"); git update-ref -d $(printf %q "${SYNC_REF}") 2>/dev/null || true" EXIT
  # bundle 必须带 named ref：裸 SHA 会 Refusing to create empty bundle
  git update-ref "${SYNC_REF}" "${tip_sha}"
  remote_head="$(remote_ssh "git -C $(printf %q "${remote_abs}") rev-parse HEAD" 2>/dev/null || true)"
  info "制作 git bundle…"
  if [ -n "${remote_head}" ] && git merge-base --is-ancestor "${remote_head}" "${tip_sha}" 2>/dev/null; then
    git bundle create "${bundle_local}" "${SYNC_REF}" --not "${remote_head}" || \
      git bundle create "${bundle_local}" "${SYNC_REF}"
  else
    git bundle create "${bundle_local}" "${SYNC_REF}"
  fi
  scp -o BatchMode=yes -o ConnectTimeout="${CONNECT_TIMEOUT}" \
    "${bundle_local}" "${SSH_HOST}:${bundle_remote}"
  remote_ssh "env \
PIER_E2E_REMOTE_ABS=$(printf %q "${remote_abs}") \
PIER_E2E_BUNDLE=$(printf %q "${bundle_remote}") \
PIER_E2E_SYNC_REF=$(printf %q "${SYNC_REF}") \
PIER_E2E_TIP_SHA=$(printf %q "${tip_sha}") \
bash -s" <<'EOS'
set -euo pipefail
cd "${PIER_E2E_REMOTE_ABS}"
git bundle verify "${PIER_E2E_BUNDLE}" >/dev/null
git fetch "${PIER_E2E_BUNDLE}" "+${PIER_E2E_SYNC_REF}:${PIER_E2E_SYNC_REF}"
rm -f "${PIER_E2E_BUNDLE}"
EOS
  rm -f "${bundle_local}"
  git update-ref -d "${SYNC_REF}" 2>/dev/null || true
  trap - EXIT
fi

remote_ssh "export PIER_E2E_REMOTE_ABS=$(printf %q "${remote_abs}") PIER_E2E_TIP_SHA=$(printf %q "${tip_sha}"); bash -s" <<'EOS'
set -euo pipefail
cd "${PIER_E2E_REMOTE_ABS}"
git reset --hard HEAD >/dev/null 2>&1 || true
git clean -fd \
  -e node_modules \
  -e native/build \
  -e native/Vendor \
  -e out \
  -e dist-builder \
  >/dev/null 2>&1 || true
git checkout --detach --force "${PIER_E2E_TIP_SHA}"
git reset --hard "${PIER_E2E_TIP_SHA}" >/dev/null
EOS

# vitest args
VITEST_ARGS=("$@")
if [ "${#VITEST_ARGS[@]}" -eq 0 ]; then
  VITEST_ARGS=(
    tests/unit/main/adapters/local-control-session.test.ts
    tests/unit/main/adapters/local-control-architecture-loop.test.ts
    tests/unit/main/adapters/local-control-runtime-ops.test.ts
    tests/unit/main/adapters/local-control-runtime-socket.test.ts
    tests/unit/main/adapters/local-control-invoke-withdrawn.test.ts
    tests/unit/main/services/runtime-control
    tests/unit/shared/local-control-frames.test.ts
    tests/unit/shared/local-control-runtime-ref.test.ts
    tests/unit/cli/cli-surface-governance.test.ts
    tests/unit/cli/multi-agent-boundary-governance.test.ts
  )
fi
args_b64="$(printf '%q ' "${VITEST_ARGS[@]}" | base64 | tr -d '\n')"

info "在远端跑 vitest…"
remote_ssh "env \
PIER_E2E_REMOTE_DIR=$(printf %q "${REMOTE_DIR}") \
PIER_E2E_EXPECT_SHA=$(printf %q "${tip_sha}") \
PIER_E2E_REMOTE_PATH=$(printf %q "${DEFAULT_REMOTE_PATH}") \
PIER_UNIT_ARGS_B64=$(printf %q "${args_b64}") \
bash -s" <<'REMOTE'
set -euo pipefail

_path_template="${PIER_E2E_REMOTE_PATH}"
# shellcheck disable=SC2086
eval "export PATH=\"${_path_template}\""

if [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv 2>/dev/null)" || true
elif [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" || true
fi
for _p in \
  /usr/local/opt/node@24/bin \
  /opt/homebrew/opt/node@24/bin \
  "${HOME}/.local/bin" \
  "${HOME}/.local-pnpm-e2e/bin"; do
  if [ -d "${_p}" ]; then
    PATH="${_p}:${PATH}"
  fi
done
export PATH

if [[ "${PIER_E2E_REMOTE_DIR}" = /* ]]; then
  cd "${PIER_E2E_REMOTE_DIR}"
else
  cd "${HOME%/}/${PIER_E2E_REMOTE_DIR}"
fi

actual="$(git rev-parse HEAD)"
if [ "${actual}" != "${PIER_E2E_EXPECT_SHA}" ]; then
  echo "[unit-remote] HEAD ${actual:0:12} != expect ${PIER_E2E_EXPECT_SHA:0:12}" >&2
  exit 2
fi

if [ ! -d node_modules ]; then
  echo "[unit-remote] pnpm install…" >&2
  if [ -f pnpm-lock.yaml ]; then
    pnpm install --frozen-lockfile || pnpm install
  else
    pnpm install
  fi
fi

if [ -n "${PIER_UNIT_ARGS_B64:-}" ]; then
  _decoded="$(printf '%s' "${PIER_UNIT_ARGS_B64}" | base64 --decode 2>/dev/null \
    || printf '%s' "${PIER_UNIT_ARGS_B64}" | base64 -D 2>/dev/null \
    || printf '%s' "${PIER_UNIT_ARGS_B64}" | base64 -d 2>/dev/null)"
  # shellcheck disable=SC2086
  eval "set -- ${_decoded}"
  pnpm exec vitest run "$@"
else
  pnpm exec vitest run tests/unit/main/services/agent-invoke-service.test.ts
fi
REMOTE
