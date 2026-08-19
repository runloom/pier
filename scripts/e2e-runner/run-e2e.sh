#!/usr/bin/env bash
#
# 优先在闲置 Mac（self-hosted e2e 机）上跑 Playwright e2e，不可达再回退本机。
#
# 用法（仓库根或任意 cwd，脚本会定位 pier 根）：
#   bash scripts/e2e-runner/run-e2e.sh
#   bash scripts/e2e-runner/run-e2e.sh tests/e2e/app/startup-stability.spec.ts
#   bash scripts/e2e-runner/run-e2e.sh --local tests/e2e/git/review.spec.ts
#   bash scripts/e2e-runner/run-e2e.sh --remote --rebuild
#
# 环境变量：
#   PIER_E2E_SSH_HOST          SSH Host / user@host，默认 pier-e2e
#   PIER_E2E_REMOTE_DIR        远端仓库：相对路径挂到远端 $HOME（默认 pier → $HOME/pier），
#                              或远端绝对路径。勿填本机已展开的 $HOME。
#   PIER_E2E_CONNECT_TIMEOUT   SSH 探测秒数，默认 4
#   PIER_E2E_FORCE_LOCAL=1     同 --local
#   PIER_E2E_FORCE_REMOTE=1    同 --remote（远端不可达则失败，不回退）
#   PIER_E2E_REBUILD=1         同 --rebuild（强制 plugins:pack + build:electron）
#   PIER_E2E_REMOTE_PATH       可选；覆盖远端 PATH（须为远端机上的绝对路径列表，
#                              用 : 分隔）。未设置时用脚本内默认 brew/node 前缀。
#   ELECTRON_MIRROR            透传到远端；github.com 不可达时用镜像装 Electron
#                              （例：https://npmmirror.com/mirrors/electron/）
#   PIER_E2E_COMMITTED_ONLY=1  同 --committed-only：只同步已提交 HEAD；
#                              工作区 dirty 时拒绝远端（避免“以为测了本地改动”）。
#   PIER_E2E_SKIP_SYNC=1       跳过「同步本机 tip 到远端」（仅调试用，易测错 commit）
#
# 远端默认会把仓库 checkout 到与本机相同的 tip：
#   - clean：git HEAD
#   - dirty：临时 worktree snapshot commit（含已跟踪改动 + 未忽略的未跟踪文件）
# 使用 git bundle 补对象（不必先 push）；tree 变化或缺少 out/main 时自动 rebuild。
#
# 给 AI / 人类的约定见 AGENTS.md「E2E 执行优先级」。
#
set -euo pipefail

# 日志一律 stderr，避免污染 $(...) 捕获
info() { printf '\033[1;34m[e2e-run]\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m[e2e-run]\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31m[e2e-run]\033[0m %s\n' "$*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

SSH_HOST="${PIER_E2E_SSH_HOST:-pier-e2e}"
REMOTE_DIR="${PIER_E2E_REMOTE_DIR:-pier}"
CONNECT_TIMEOUT="${PIER_E2E_CONNECT_TIMEOUT:-4}"
FORCE_LOCAL="${PIER_E2E_FORCE_LOCAL:-0}"
FORCE_REMOTE="${PIER_E2E_FORCE_REMOTE:-0}"
REBUILD="${PIER_E2E_REBUILD:-0}"
COMMITTED_ONLY="${PIER_E2E_COMMITTED_ONLY:-0}"
SKIP_SYNC="${PIER_E2E_SKIP_SYNC:-0}"
DEFAULT_REMOTE_PATH='${HOME}/.local-pnpm-e2e/bin:${HOME}/.local/bin:/usr/local/opt/node@24/bin:/usr/local/opt/zig@0.15/bin:/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/zig@0.15/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-/usr/bin:/bin}'
REMOTE_PATH="${PIER_E2E_REMOTE_PATH:-}"
SYNC_REF="refs/pier-e2e/sync-tip"

PLAYWRIGHT_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --local)
      FORCE_LOCAL=1
      shift
      ;;
    --remote)
      FORCE_REMOTE=1
      shift
      ;;
    --rebuild)
      REBUILD=1
      shift
      ;;
    --committed-only)
      COMMITTED_ONLY=1
      shift
      ;;
    --allow-dirty-remote)
      warn "--allow-dirty-remote 已废弃：远端默认会同步 dirty 工作区。只要已提交 HEAD 请改用 --committed-only"
      shift
      ;;
    --skip-sync)
      SKIP_SYNC=1
      shift
      ;;
    --help|-h)
      sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --)
      shift
      PLAYWRIGHT_ARGS+=("$@")
      break
      ;;
    *)
      PLAYWRIGHT_ARGS+=("$1")
      shift
      ;;
  esac
done

if [ "${FORCE_LOCAL}" = "1" ] && [ "${FORCE_REMOTE}" = "1" ]; then
  err "不能同时 --local 与 --remote"
  exit 2
fi

remote_ssh() {
  # shellcheck disable=SC2029
  ssh -o BatchMode=yes \
    -o ConnectTimeout="${CONNECT_TIMEOUT}" \
    -o ConnectionAttempts=1 \
    -o StrictHostKeyChecking=accept-new \
    "${SSH_HOST}" "$@"
}

remote_reachable() {
  remote_ssh 'echo ok' >/dev/null 2>&1
}

# 在远端展开仓库路径（与 run_remote 内逻辑一致）
remote_repo_expr() {
  remote_ssh "export PIER_E2E_REMOTE_DIR=$(printf %q "${REMOTE_DIR}"); bash -s" <<'EOS'
set -euo pipefail
_raw="${PIER_E2E_REMOTE_DIR:-pier}"
case "${_raw}" in
  /*) printf '%s\n' "${_raw}" ;;
  "~/"*) printf '%s\n' "${HOME}/${_raw#~/}" ;;
  "~") printf '%s\n' "${HOME}" ;;
  *) printf '%s\n' "${HOME}/${_raw}" ;;
esac
EOS
}

# 远端强制切到 tip：清 skip-worktree/assume-unchanged，避免 “Entry not uptodate”
remote_hard_switch() {
  local remote_abs="$1"
  local tip_sha="$2"
  # 路径经 printf %q 塞进远端 shell，避免空格用户名把 env 拆词
  remote_ssh "env \
PIER_E2E_REMOTE_ABS=$(printf %q "${remote_abs}") \
PIER_E2E_TIP_SHA=$(printf %q "${tip_sha}") \
bash -s" <<'EOS'
set -euo pipefail
cd "${PIER_E2E_REMOTE_ABS}"

# 只清 skip-worktree (S/s) 与 assume-unchanged (小写 h 等)；不要匹配普通 H
while IFS= read -r line; do
  flag="${line:0:1}"
  path="${line:2}"
  case "${flag}" in
    S|s|h)
      [ -n "${path}" ] || continue
      git update-index --no-skip-worktree -- "${path}" 2>/dev/null || true
      git update-index --no-assume-unchanged -- "${path}" 2>/dev/null || true
      ;;
  esac
done < <(git ls-files -v 2>/dev/null || true)

git reset --hard HEAD >/dev/null 2>&1 || true
git clean -fd \
  -e node_modules \
  -e native/build \
  -e native/Vendor \
  -e out \
  -e dist-builder \
  -e .pier-e2e-last-build-sha \
  >/dev/null 2>&1 || git clean -fd >/dev/null

git checkout --detach --force "${PIER_E2E_TIP_SHA}"
git reset --hard "${PIER_E2E_TIP_SHA}" >/dev/null
git clean -fd \
  -e node_modules \
  -e native/build \
  -e native/Vendor \
  -e out \
  -e dist-builder \
  -e .pier-e2e-last-build-sha \
  >/dev/null 2>&1 || true
git reflog expire --expire=2.days.ago --all >/dev/null 2>&1 || true
EOS
}

run_local() {
  info "在本机执行 e2e（会弹出 Electron 测试窗，可能打扰当前使用）"
  if [ "${REBUILD}" = "1" ]; then
    info "本机 rebuild: plugins:pack + build:electron"
    pnpm plugins:pack
    pnpm build:electron
  elif [ ! -f out/main/index.js ]; then
    info "本机缺少 out/main → plugins:pack + build:electron"
    pnpm plugins:pack
    pnpm build:electron
  else
    pnpm plugins:pack
  fi
  if [ "${#PLAYWRIGHT_ARGS[@]}" -eq 0 ]; then
    pnpm exec playwright test --config playwright.config.ts
  else
    pnpm exec playwright test --config playwright.config.ts "${PLAYWRIGHT_ARGS[@]}"
  fi
}

# 解析本次要测的 tip：clean → HEAD；dirty → 临时 snapshot commit（不改工作区/分支）
resolve_local_tip() {
  local head_sha head_tree tmp_index tree_sha tip_sha
  head_sha="$(git rev-parse HEAD)"

  if [ -z "$(git status --porcelain 2>/dev/null || true)" ]; then
    printf '%s\n' "${head_sha}"
    return 0
  fi

  if [ "${COMMITTED_ONLY}" = "1" ]; then
    err "本机工作区有未提交变更，且指定了 --committed-only（只测已提交 HEAD）。"
    err "开发中要测本地改动：去掉 --committed-only（默认会把 dirty 工作区同步到闲置机）。"
    err "或先提交/stash，或改用: bash scripts/e2e-runner/run-e2e.sh --local …"
    return 2
  fi

  head_tree="$(git rev-parse 'HEAD^{tree}')"
  tmp_index="$(mktemp "${TMPDIR:-/tmp}/pier-e2e-index.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -f $(printf %q "${tmp_index}")" RETURN

  if ! GIT_INDEX_FILE="${tmp_index}" git read-tree "${head_sha}"; then
    err "无法读取 HEAD 树以制作 dirty snapshot"
    return 1
  fi
  if ! GIT_INDEX_FILE="${tmp_index}" git add -A -- .; then
    err "无法把 dirty 工作区写入临时 index"
    return 1
  fi
  tree_sha="$(GIT_INDEX_FILE="${tmp_index}" git write-tree)"
  rm -f "${tmp_index}"
  trap - RETURN

  if [ "${tree_sha}" = "${head_tree}" ]; then
    printf '%s\n' "${head_sha}"
    return 0
  fi

  tip_sha="$(git commit-tree "${tree_sha}" -p "${head_sha}" -m "pier-e2e worktree snapshot")"
  info "dirty 工作区 → snapshot ${tip_sha:0:12}（parent ${head_sha:0:12}）"
  printf '%s\n' "${tip_sha}"
}

# 把 tip 对象送进远端并 checkout --detach。返回 0 成功。
sync_remote_to_tip() {
  local tip_sha remote_abs bundle_local bundle_remote remote_head merge_base bundle_mode remote_rc
  tip_sha="${1:-}"
  if [ -z "${tip_sha}" ]; then
    err "sync_remote_to_tip: missing tip sha"
    return 1
  fi

  info "同步 tip ${tip_sha:0:12} → 远端 ${SSH_HOST}"

  remote_abs="$(remote_repo_expr)"
  if [ -z "${remote_abs}" ]; then
    err "无法解析远端仓库路径"
    return 1
  fi

  if ! remote_ssh "test -d $(printf %q "${remote_abs}/.git")"; then
    err "远端不存在 git 仓库: ${remote_abs}"
    err "请先在闲置机 clone：git clone git@github.com:runloom/pier.git ~/pier"
    return 1
  fi

  if remote_ssh "git -C $(printf %q "${remote_abs}") cat-file -t $(printf %q "${tip_sha}")" >/dev/null 2>&1; then
    info "远端已有对象，checkout --detach ${tip_sha:0:12}"
    remote_hard_switch "${remote_abs}" "${tip_sha}"
    return 0
  fi

  bundle_local="$(mktemp "${TMPDIR:-/tmp}/pier-e2e-bundle.XXXXXX")"
  bundle_remote="/tmp/pier-e2e-bundle-${tip_sha:0:12}.bundle"
  # shellcheck disable=SC2064
  trap "rm -f $(printf %q "${bundle_local}"); git update-ref -d $(printf %q "${SYNC_REF}") 2>/dev/null || true" RETURN

  # bundle 必须带 named ref：裸 SHA range 会「Refusing to create empty bundle」
  git update-ref "${SYNC_REF}" "${tip_sha}"

  remote_head="$(remote_ssh "git -C $(printf %q "${remote_abs}") rev-parse HEAD" 2>/dev/null || true)"
  merge_base=""

  create_bundle() {
    local mode="$1"
    rm -f "${bundle_local}"
    case "${mode}" in
      thin-head)
        git bundle create "${bundle_local}" "${SYNC_REF}" --not "${remote_head}"
        ;;
      thin-base)
        git bundle create "${bundle_local}" "${SYNC_REF}" --not "${merge_base}"
        ;;
      full)
        git bundle create "${bundle_local}" "${SYNC_REF}"
        ;;
      *)
        return 1
        ;;
    esac
  }

  bundle_mode=""
  if [ -n "${remote_head}" ] && git merge-base --is-ancestor "${remote_head}" "${tip_sha}" 2>/dev/null; then
    info "制作增量 bundle（--not 远端 HEAD ${remote_head:0:12}）…"
    if create_bundle thin-head 2>/dev/null; then
      bundle_mode="thin-head"
    else
      warn "增量 bundle 失败，改全量 tip bundle"
    fi
  fi

  if [ -z "${bundle_mode}" ] && [ -n "${remote_head}" ]; then
    merge_base="$(git merge-base "${remote_head}" "${tip_sha}" 2>/dev/null || true)"
    if [ -n "${merge_base}" ]; then
      info "制作增量 bundle（--not merge-base ${merge_base:0:12}）…"
      if create_bundle thin-base 2>/dev/null; then
        bundle_mode="thin-base"
      fi
    fi
  fi

  if [ -z "${bundle_mode}" ]; then
    info "制作全量 tip bundle…"
    create_bundle full
    bundle_mode="full"
  fi

  scp -o BatchMode=yes \
    -o ConnectTimeout="${CONNECT_TIMEOUT}" \
    -o ConnectionAttempts=1 \
    "${bundle_local}" \
    "${SSH_HOST}:${bundle_remote}"

  import_bundle_on_remote() {
    remote_ssh "env \
PIER_E2E_REMOTE_ABS=$(printf %q "${remote_abs}") \
PIER_E2E_BUNDLE=$(printf %q "${bundle_remote}") \
PIER_E2E_SYNC_REF=$(printf %q "${SYNC_REF}") \
PIER_E2E_TIP_SHA=$(printf %q "${tip_sha}") \
bash -s" <<'EOS'
set -euo pipefail
cd "${PIER_E2E_REMOTE_ABS}"
if ! git bundle verify "${PIER_E2E_BUNDLE}" >/dev/null 2>&1; then
  echo "[e2e-run:remote] bundle verify failed (missing prerequisites?)" >&2
  rm -f "${PIER_E2E_BUNDLE}"
  exit 11
fi
git fetch "${PIER_E2E_BUNDLE}" "+${PIER_E2E_SYNC_REF}:${PIER_E2E_SYNC_REF}" 2>/dev/null \
  || git fetch "${PIER_E2E_BUNDLE}" "${PIER_E2E_SYNC_REF}:${PIER_E2E_SYNC_REF}" 2>/dev/null \
  || git bundle unbundle "${PIER_E2E_BUNDLE}" >/dev/null
if ! git cat-file -t "${PIER_E2E_TIP_SHA}" >/dev/null 2>&1; then
  git bundle unbundle "${PIER_E2E_BUNDLE}" >/dev/null || true
fi
if ! git cat-file -t "${PIER_E2E_TIP_SHA}" >/dev/null 2>&1; then
  echo "[e2e-run:remote] ERROR: tip ${PIER_E2E_TIP_SHA} missing after bundle import" >&2
  rm -f "${PIER_E2E_BUNDLE}"
  exit 12
fi
git update-ref -d "${PIER_E2E_SYNC_REF}" 2>/dev/null || true
rm -f "${PIER_E2E_BUNDLE}"
EOS
  }

  set +e
  import_bundle_on_remote
  remote_rc=$?
  set -e

  if [ "${remote_rc}" -ne 0 ]; then
    if [ "${remote_rc}" -eq 11 ] && [ "${bundle_mode}" != "full" ]; then
      warn "远端缺少增量 bundle 前置对象 → 重传全量 tip bundle"
      create_bundle full
      bundle_mode="full"
      scp -o BatchMode=yes \
        -o ConnectTimeout="${CONNECT_TIMEOUT}" \
        -o ConnectionAttempts=1 \
        "${bundle_local}" \
        "${SSH_HOST}:${bundle_remote}"
      set +e
      import_bundle_on_remote
      remote_rc=$?
      set -e
    fi
    if [ "${remote_rc}" -ne 0 ]; then
      err "远端导入 tip bundle 失败（exit ${remote_rc}, mode=${bundle_mode}）"
      return "${remote_rc}"
    fi
  fi

  remote_hard_switch "${remote_abs}" "${tip_sha}"

  git update-ref -d "${SYNC_REF}" 2>/dev/null || true
  rm -f "${bundle_local}"
  trap - RETURN
  info "远端已 checkout ${tip_sha:0:12}"
}

REMOTE_LOCK_DIR="/tmp/pier-e2e-remote.lock"
REMOTE_LOCK_WAIT_SEC="${PIER_E2E_LOCK_WAIT_SEC:-1800}"
# 默认 4h：self-hosted full suite 允许到 3h；无 heartbeat，靠 token 防误删
REMOTE_LOCK_STALE_SEC="${PIER_E2E_LOCK_STALE_SEC:-14400}"
REMOTE_LOCK_TOKEN=""

acquire_remote_lock() {
  local tip_sha="$1"
  local deadline owner mtime now age started_epoch
  REMOTE_LOCK_TOKEN="$(hostname 2>/dev/null || echo local)-$$-$(date +%s)-${RANDOM}"
  deadline=$((SECONDS + REMOTE_LOCK_WAIT_SEC))
  info "获取远端 e2e 锁 ${REMOTE_LOCK_DIR}（wait≤${REMOTE_LOCK_WAIT_SEC}s）"
  while true; do
    if remote_ssh "mkdir $(printf %q "${REMOTE_LOCK_DIR}")" 2>/dev/null; then
      started_epoch="$(date +%s)"
      remote_ssh "printf 'token=%s\\nhost=%s\\ntip=%s\\nstarted=%s\\nstarted_epoch=%s\\n' \
$(printf %q "${REMOTE_LOCK_TOKEN}") \
$(printf %q "$(hostname 2>/dev/null || echo local)") \
$(printf %q "${tip_sha:0:12}") \
$(printf %q "$(date -u +%Y-%m-%dT%H:%M:%SZ)") \
$(printf %q "${started_epoch}") > $(printf %q "${REMOTE_LOCK_DIR}/owner")"
      return 0
    fi
    owner="$(remote_ssh "cat $(printf %q "${REMOTE_LOCK_DIR}/owner") 2>/dev/null || true" || true)"
    # 陈旧：优先用 owner 内 started_epoch（两端都写 epoch 秒，减时钟漂移影响）
    started_epoch="$(printf '%s\n' "${owner}" | sed -n 's/^started_epoch=//p' | head -1)"
    now="$(date +%s)"
    if [ -n "${started_epoch}" ] && [ "${started_epoch}" -gt 0 ] 2>/dev/null; then
      age=$((now - started_epoch))
    else
      mtime="$(remote_ssh "stat -f %m $(printf %q "${REMOTE_LOCK_DIR}") 2>/dev/null" || true)"
      if [ -n "${mtime}" ] && [ "${mtime}" -gt 0 ] 2>/dev/null; then
        age=$((now - mtime))
      else
        age=0
      fi
    fi
    if [ "${age}" -lt 0 ]; then
      age=0
    fi
    if [ "${age}" -ge "${REMOTE_LOCK_STALE_SEC}" ]; then
      warn "远端锁已陈旧 ${age}s（>${REMOTE_LOCK_STALE_SEC}s），强制回收：${owner:-unknown}"
      remote_ssh "rm -rf $(printf %q "${REMOTE_LOCK_DIR}")" || true
      continue
    fi
    if [ "${SECONDS}" -ge "${deadline}" ]; then
      err "无法在 ${REMOTE_LOCK_WAIT_SEC}s 内获得远端锁：${owner:-unknown}"
      return 5
    fi
    info "等待远端锁… ${owner:-unknown} age=${age}s"
    sleep 5
  done
}

release_remote_lock() {
  # 只删自己的锁：避免长任务被 stale 抢锁后，旧 EXIT trap 误删新 holder
  if [ -z "${REMOTE_LOCK_TOKEN}" ]; then
    return 0
  fi
  remote_ssh "set -euo pipefail
lock=$(printf %q "${REMOTE_LOCK_DIR}")
token=$(printf %q "${REMOTE_LOCK_TOKEN}")
if [ -f \"\${lock}/owner\" ]; then
  cur=\$(sed -n 's/^token=//p' \"\${lock}/owner\" | head -1)
  if [ \"\${cur}\" = \"\${token}\" ]; then
    rm -rf \"\${lock}\"
  fi
fi
" 2>/dev/null || true
}

run_remote() {
  local tip_sha tip_tree rebuild_flag remote_path_payload pw_args_b64 remote_rc

  tip_sha="$(resolve_local_tip)" || return $?
  tip_tree="$(git rev-parse "${tip_sha}^{tree}")"
  info "在闲置机执行 e2e via ssh ${SSH_HOST} (repo=${REMOTE_DIR} tip=${tip_sha:0:12})"

  # 同步前拿远端互斥锁，覆盖 checkout + build + playwright 全程
  acquire_remote_lock "${tip_sha}" || return 1
  # shellcheck disable=SC2064
  trap 'release_remote_lock' EXIT INT TERM

  if [ "${SKIP_SYNC}" = "1" ]; then
    warn "PIER_E2E_SKIP_SYNC=1：跳过同步，远端可能不是本机 tip"
  else
    sync_remote_to_tip "${tip_sha}" || return 1
  fi

  # 多路径/含空格参数不能直接塞进 ssh env（会被拆词）。
  # 先 printf %q，再 base64 成单 token；远端 decode 后 eval set。
  pw_args_b64=""
  if [ "${#PLAYWRIGHT_ARGS[@]}" -gt 0 ]; then
    pw_args_b64="$(printf '%q ' "${PLAYWRIGHT_ARGS[@]}" | base64 | tr -d '\n')"
  fi

  rebuild_flag=0
  if [ "${REBUILD}" = "1" ]; then
    rebuild_flag=1
  fi

  if [ -n "${REMOTE_PATH}" ]; then
    remote_path_payload="${REMOTE_PATH}"
  else
    remote_path_payload="${DEFAULT_REMOTE_PATH}"
  fi

  set +e
  # shellcheck disable=SC2087
  remote_ssh "env \
PIER_E2E_REBUILD=$(printf %q "${rebuild_flag}") \
PIER_E2E_REMOTE_DIR=$(printf %q "${REMOTE_DIR}") \
PIER_E2E_PW_ARGS_B64=$(printf %q "${pw_args_b64}") \
PIER_E2E_EXPECT_SHA=$(printf %q "${tip_sha}") \
PIER_E2E_EXPECT_TREE=$(printf %q "${tip_tree}") \
PIER_E2E_REMOTE_PATH=$(printf %q "${remote_path_payload}") \
ELECTRON_MIRROR=$(printf %q "${ELECTRON_MIRROR:-}") \
bash -s" <<'REMOTE'
set -euo pipefail

if [ -n "${ELECTRON_MIRROR:-}" ]; then
  export ELECTRON_MIRROR
  echo "[e2e-run:remote] ELECTRON_MIRROR=${ELECTRON_MIRROR}"
fi

_path_template="${PIER_E2E_REMOTE_PATH}"
# shellcheck disable=SC2086
eval "export PATH=\"${_path_template}\""

if [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv 2>/dev/null)" || true
elif [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" || true
fi
# brew shellenv 重排 PATH 后，强制把 node@24 / e2e-pnpm 再顶回前面
for _p in \
  /usr/local/opt/node@24/bin \
  /opt/homebrew/opt/node@24/bin \
  /usr/local/opt/zig@0.15/bin \
  /opt/homebrew/opt/zig@0.15/bin \
  "${HOME}/.local/bin" \
  "${HOME}/.local-pnpm-e2e/bin"; do
  if [ -d "${_p}" ]; then
    PATH="${_p}:${PATH}"
  fi
done
export PATH

# brew shellenv 会把 /usr/local/bin 顶到最前；较新的 pnpm 会拒绝
# packageManager=pnpm@11.12.0 的仓库。始终用项目锁定版本，装到独立 prefix。
ensure_project_pnpm() {
  local want raw ver prefix bin
  want=""
  if [ -f package.json ]; then
    raw="$(node -p "try{require('./package.json').packageManager||''}catch(e){''}" 2>/dev/null || true)"
    case "${raw}" in
      pnpm@*) want="${raw#pnpm@}" ;;
    esac
    # Corepack 会写成 11.18.0+sha512.…；pnpm -v 只有 11.18.0
    want="${want%%+*}"
  fi
  if [ -z "${want}" ]; then
    return 0
  fi
  prefix="${HOME}/.local-pnpm-e2e"
  bin="${prefix}/bin/pnpm"
  ver="$("${bin}" -v 2>/dev/null || true)"
  if [ "${ver}" != "${want}" ]; then
    echo "[e2e-run:remote] install pnpm@${want} → ${prefix}"
    mkdir -p "${prefix}"
    npm install -g "pnpm@${want}" --prefix "${prefix}"
  fi
  export PATH="${prefix}/bin:${PATH}"
  hash -r 2>/dev/null || true
  ver="$(pnpm -v 2>/dev/null || true)"
  if [ "${ver}" != "${want}" ]; then
    echo "[e2e-run:remote] ERROR: pnpm ${ver:-missing} != packageManager ${want}" >&2
    exit 4
  fi
}

_raw="${PIER_E2E_REMOTE_DIR:-pier}"
case "${_raw}" in
  /*) REMOTE_DIR="${_raw}" ;;
  "~/"*) REMOTE_DIR="${HOME}/${_raw#~/}" ;;
  "~") REMOTE_DIR="${HOME}" ;;
  *) REMOTE_DIR="${HOME}/${_raw}" ;;
esac
cd "${REMOTE_DIR}"
ensure_project_pnpm

actual="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
actual_tree="$(git rev-parse 'HEAD^{tree}' 2>/dev/null || echo unknown)"
echo "[e2e-run:remote] cwd=$(pwd) head=${actual:0:12} tree=${actual_tree:0:12} expect=${PIER_E2E_EXPECT_SHA:0:12} node=$(node -v 2>/dev/null) pnpm=$(pnpm -v 2>/dev/null)"

if [ -n "${PIER_E2E_EXPECT_SHA:-}" ] && [ "${actual}" != "${PIER_E2E_EXPECT_SHA}" ]; then
  echo "[e2e-run:remote] ERROR: HEAD ${actual} != expect ${PIER_E2E_EXPECT_SHA}" >&2
  exit 3
fi

build_marker=".pier-e2e-last-build-sha"
# 用 tree id 判定是否需要 rebuild：同一 dirty 树重复跑可跳过 electron build
build_id="${PIER_E2E_EXPECT_TREE:-${actual_tree}}"
need_build=0
if [ "${PIER_E2E_REBUILD:-0}" = "1" ]; then
  need_build=1
elif [ ! -f out/main/index.js ]; then
  need_build=1
elif [ ! -f "${build_marker}" ] || [ "$(cat "${build_marker}" 2>/dev/null || true)" != "${build_id}" ]; then
  need_build=1
elif [ ! -f native/build/Release/ghostty_native.node ]; then
  echo "[e2e-run:remote] WARN: missing native/build/Release/ghostty_native.node — still building electron; native may fail e2e" >&2
  need_build=1
fi

if [ "${need_build}" = "1" ]; then
  echo "[e2e-run:remote] plugins:pack + build:electron"
  # dirty snapshot 后依赖锁若变更需要 install；失败不静默
  if [ -f pnpm-lock.yaml ]; then
    pnpm install --frozen-lockfile || pnpm install
  fi
  pnpm plugins:pack
  pnpm build:electron
  printf '%s\n' "${build_id}" > "${build_marker}"
else
  pnpm plugins:pack
fi

# playwright args：base64(printf %q ...) → eval set，保留多路径/空格
if [ -n "${PIER_E2E_PW_ARGS_B64:-}" ]; then
  _pw_decoded="$(printf '%s' "${PIER_E2E_PW_ARGS_B64}" | base64 --decode 2>/dev/null \
    || printf '%s' "${PIER_E2E_PW_ARGS_B64}" | base64 -D 2>/dev/null \
    || printf '%s' "${PIER_E2E_PW_ARGS_B64}" | base64 -d 2>/dev/null)"
  # shellcheck disable=SC2086
  eval "set -- ${_pw_decoded}"
  pnpm exec playwright test --config playwright.config.ts "$@"
else
  pnpm exec playwright test --config playwright.config.ts
fi
REMOTE
  remote_rc=$?
  set -e
  release_remote_lock
  trap - EXIT INT TERM
  return "${remote_rc}"
}

# ---------- 决策 ----------
if [ "${FORCE_LOCAL}" = "1" ]; then
  info "强制本机（--local / PIER_E2E_FORCE_LOCAL）"
  run_local
  exit $?
fi

if remote_reachable; then
  info "闲置机可达: ${SSH_HOST}"
  set +e
  run_remote
  remote_status=$?
  set -e
  if [ "${remote_status}" -ne 0 ]; then
    if [ "${FORCE_REMOTE}" = "1" ]; then
      err "远端 e2e 失败且强制 --remote，不回退本机（exit ${remote_status}）"
      exit "${remote_status}"
    fi
    err "远端 e2e 失败（exit ${remote_status}）。不自动回退本机；需要本机时显式 --local"
    exit "${remote_status}"
  fi
  exit 0
fi

if [ "${FORCE_REMOTE}" = "1" ]; then
  err "闲置机不可达（${SSH_HOST}）且强制 --remote"
  err "请检查：笔记本开机接电、远程登录已开、~/.ssh/config 中 Host pier-e2e 的 HostName/User"
  exit 1
fi

warn "闲置机不可达（ssh ${SSH_HOST}，timeout=${CONNECT_TIMEOUT}s）→ 回退本机"
warn "配置 SSH：见 scripts/e2e-runner/FIRST-BOOT.txt「主力机 SSH Host」"
run_local
