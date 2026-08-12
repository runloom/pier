#!/usr/bin/env bash
# W6 socket 冒烟：同步 dirty tip → pier-e2e 起 Electron → pier CLI 对 socket 测 snapshot/watch/cli-human。
# 用法（仓库根）：bash scripts/w6-remote-socket-smoke.sh
set -euo pipefail

info() { printf '\033[1;34m[w6-smoke]\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31m[w6-smoke]\033[0m %s\n' "$*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SSH_HOST="${PIER_E2E_SSH_HOST:-pier-e2e}"
REMOTE_DIR="${PIER_E2E_REMOTE_DIR:-pier}"
CONNECT_TIMEOUT="${PIER_E2E_CONNECT_TIMEOUT:-8}"
SYNC_REF="refs/pier-e2e/sync-tip"
REMOTE_PATH='${HOME}/.local-pnpm-e2e/bin:${HOME}/.local/bin:/usr/local/opt/node@24/bin:/usr/local/opt/zig@0.15/bin:/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/zig@0.15/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-/usr/bin:/bin}'

remote_ssh() {
  ssh -o BatchMode=yes -o ConnectTimeout="${CONNECT_TIMEOUT}" -o ConnectionAttempts=1 \
    -o StrictHostKeyChecking=accept-new "${SSH_HOST}" "$@"
}

if ! remote_ssh 'echo ok' >/dev/null 2>&1; then
  err "pier-e2e 不可达"
  exit 1
fi
info "pier-e2e 可达"

# --- dirty tip snapshot（对齐 e2e-runner）---
head_sha="$(git rev-parse HEAD)"
if [ -z "$(git status --porcelain 2>/dev/null || true)" ]; then
  tip_sha="${head_sha}"
  info "clean tip ${tip_sha:0:12}"
else
  tmp_index="$(mktemp "${TMPDIR:-/tmp}/pier-w6-idx.XXXXXX")"
  GIT_INDEX_FILE="${tmp_index}" git read-tree "${head_sha}"
  GIT_INDEX_FILE="${tmp_index}" git add -A -- .
  tree_sha="$(GIT_INDEX_FILE="${tmp_index}" git write-tree)"
  rm -f "${tmp_index}"
  tip_sha="$(git commit-tree "${tree_sha}" -p "${head_sha}" -m "pier-w6-smoke worktree snapshot")"
  info "dirty snapshot ${tip_sha:0:12} (parent ${head_sha:0:12})"
fi

remote_abs="$(remote_ssh "echo \$HOME/${REMOTE_DIR}")"
info "远端仓库 ${remote_abs}"

# --- sync tip ---
git update-ref "${SYNC_REF}" "${tip_sha}"
cleanup_ref() { git update-ref -d "${SYNC_REF}" 2>/dev/null || true; }
trap cleanup_ref EXIT

if ! remote_ssh "git -C $(printf %q "${remote_abs}") cat-file -t $(printf %q "${tip_sha}")" >/dev/null 2>&1; then
  bundle_local="$(mktemp "${TMPDIR:-/tmp}/pier-w6-bundle.XXXXXX")"
  bundle_remote="/tmp/pier-w6-bundle-${tip_sha:0:12}.bundle"
  remote_head="$(remote_ssh "git -C $(printf %q "${remote_abs}") rev-parse HEAD" 2>/dev/null || true)"
  if [ -n "${remote_head}" ] && git merge-base --is-ancestor "${remote_head}" "${tip_sha}" 2>/dev/null; then
    info "增量 bundle…"
    git bundle create "${bundle_local}" "${SYNC_REF}" --not "${remote_head}" || \
      git bundle create "${bundle_local}" "${SYNC_REF}"
  else
    info "全量 tip bundle…"
    git bundle create "${bundle_local}" "${SYNC_REF}"
  fi
  scp -o BatchMode=yes -o ConnectTimeout="${CONNECT_TIMEOUT}" \
    "${bundle_local}" "${SSH_HOST}:${bundle_remote}"
  rm -f "${bundle_local}"
  remote_ssh "cd $(printf %q "${remote_abs}") && git fetch $(printf %q "${bundle_remote}") +${SYNC_REF}:${SYNC_REF} && rm -f $(printf %q "${bundle_remote}")"
else
  info "远端已有 tip 对象"
fi

info "checkout --detach ${tip_sha:0:12}"
remote_ssh "cd $(printf %q "${remote_abs}") && git checkout --detach $(printf %q "${tip_sha}") --force && git reset --hard $(printf %q "${tip_sha}") && git clean -fd -e node_modules -e out -e native/build -e .pier-e2e-last-build-sha"

# --- rebuild if needed ---
last_sha="$(remote_ssh "cat $(printf %q "${remote_abs}/.pier-e2e-last-build-sha") 2>/dev/null || true")"
need_build=0
if [ "${last_sha}" != "${tip_sha}" ]; then
  need_build=1
fi
if ! remote_ssh "test -f $(printf %q "${remote_abs}/out/main/index.js")"; then
  need_build=1
fi
if [ "${PIER_E2E_REBUILD:-0}" = "1" ]; then
  need_build=1
fi

if [ "${need_build}" = "1" ]; then
  info "远端 rebuild electron（可能数分钟）…"
  remote_ssh "export PATH=\"${REMOTE_PATH}\"; cd $(printf %q "${remote_abs}") && \
    (test -d node_modules || pnpm install) && \
    pnpm build:electron && \
    echo $(printf %q "${tip_sha}") > .pier-e2e-last-build-sha"
else
  info "跳过 rebuild（out/main 与 tip 匹配）"
fi

# --- remote smoke body ---
info "启动 Electron + socket 冒烟…"
SMOKE_LOG="/tmp/pier-w6-socket-smoke-$(date +%Y%m%d-%H%M%S).log"
remote_ssh "export PATH=\"${REMOTE_PATH}\"; export PIER_W6_SMOKE_LOG=$(printf %q "${SMOKE_LOG}"); export PIER_W6_REMOTE_ABS=$(printf %q "${remote_abs}"); bash -s" <<'REMOTE'
set -euo pipefail
cd "${PIER_W6_REMOTE_ABS}"
export PATH="${HOME}/.local-pnpm-e2e/bin:${HOME}/.local/bin:/usr/local/opt/node@24/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-/usr/bin:/bin}"

USER_DATA="$(mktemp -d /tmp/pier-w6-ud-XXXXXX)"
echo "userData=${USER_DATA}" | tee -a "${PIER_W6_SMOKE_LOG}"
ELECTRON_BIN="${PIER_W6_REMOTE_ABS}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ ! -x "${ELECTRON_BIN}" ]; then
  ELECTRON_BIN="$(node -e "console.log(require('electron'))")"
fi
echo "electron=${ELECTRON_BIN}" | tee -a "${PIER_W6_SMOKE_LOG}"

# 清理旧 smoke 进程（仅匹配本脚本 user-data 前缀）
pkill -f "pier-w6-ud-" 2>/dev/null || true
sleep 1

# 假 runtime 后端可选：无 agent 二进制时仍可测 snapshot/watch/cli-human
export PIER_RUNTIME_CONTROL_FAKE=1

nohup "${ELECTRON_BIN}" "${PIER_W6_REMOTE_ABS}/out/main/index.js" \
  --user-data-dir="${USER_DATA}" \
  >> "${PIER_W6_SMOKE_LOG}" 2>&1 &
EPID=$!
echo "electron_pid=${EPID}" | tee -a "${PIER_W6_SMOKE_LOG}"

# 等 socket：优先 userData 下 pier-control.sock，否则 /tmp 短路径
SOCKET=""
for i in $(seq 1 60); do
  if [ -S "${USER_DATA}/pier-control.sock" ]; then
    SOCKET="${USER_DATA}/pier-control.sock"
    break
  fi
  # short path hash form
  CAND=$(ls /tmp/pier-control-*.sock 2>/dev/null | head -1 || true)
  if [ -n "${CAND}" ] && [ -S "${CAND}" ]; then
    # 确认归属：用 PIER_USER_DATA_DIR 让 CLI 自己解析
    SOCKET="via-userdata"
    break
  fi
  if ! kill -0 "${EPID}" 2>/dev/null; then
    echo "Electron exited early" | tee -a "${PIER_W6_SMOKE_LOG}"
    tail -40 "${PIER_W6_SMOKE_LOG}" || true
    exit 1
  fi
  sleep 1
done

if [ -z "${SOCKET}" ]; then
  echo "timeout waiting for control socket" | tee -a "${PIER_W6_SMOKE_LOG}"
  tail -50 "${PIER_W6_SMOKE_LOG}" || true
  kill "${EPID}" 2>/dev/null || true
  exit 1
fi
echo "socket_ready=${SOCKET}" | tee -a "${PIER_W6_SMOKE_LOG}"
ls -la /tmp/pier-control-*.sock 2>/dev/null | tee -a "${PIER_W6_SMOKE_LOG}" || true
ls -la "${USER_DATA}/pier-control.sock" 2>/dev/null | tee -a "${PIER_W6_SMOKE_LOG}" || true

export PIER_USER_DATA_DIR="${USER_DATA}"
PIER="node ${PIER_W6_REMOTE_ABS}/bin/pier.mjs"
pass=0
fail=0
step() {
  local name="$1"
  shift
  echo "=== STEP ${name} ===" | tee -a "${PIER_W6_SMOKE_LOG}"
  if "$@" >> "${PIER_W6_SMOKE_LOG}" 2>&1; then
    echo "PASS ${name}" | tee -a "${PIER_W6_SMOKE_LOG}"
    pass=$((pass + 1))
  else
    echo "FAIL ${name} (exit $?)" | tee -a "${PIER_W6_SMOKE_LOG}"
    fail=$((fail + 1))
  fi
}

# Full live control smoke (status/cli-human agents/watch)
export PIER_ROOT="${PIER_W6_REMOTE_ABS}"
export PIER_USER_DATA_DIR="${USER_DATA}"
set +e
node "${PIER_W6_REMOTE_ABS}/scripts/w6-live-control-smoke.mjs" 2>&1 | tee -a "${PIER_W6_SMOKE_LOG}"
LIVE_RC=${PIPESTATUS[0]}
set -e
if [ "${LIVE_RC}" -eq 0 ]; then
  echo "PASS live_control_smoke_suite" | tee -a "${PIER_W6_SMOKE_LOG}"
  pass=$((pass + 1))
else
  echo "FAIL live_control_smoke_suite rc=${LIVE_RC}" | tee -a "${PIER_W6_SMOKE_LOG}"
  fail=$((fail + 1))
fi

# teardown
kill "${EPID}" 2>/dev/null || true
sleep 1
kill -9 "${EPID}" 2>/dev/null || true
rm -rf "${USER_DATA}" 2>/dev/null || true

echo "=== SUMMARY pass=${pass} fail=${fail} log=${PIER_W6_SMOKE_LOG} ===" | tee -a "${PIER_W6_SMOKE_LOG}"
if [ "${fail}" -gt 0 ]; then
  exit 1
fi
exit 0
REMOTE

info "远端日志尾部："
remote_ssh "tail -80 ${SMOKE_LOG} 2>/dev/null || tail -80 /tmp/pier-w6-socket-smoke-*.log 2>/dev/null | tail -80"
info "完成"
