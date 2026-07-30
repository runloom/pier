#!/usr/bin/env bash
#
# 优先在闲置 Mac（self-hosted e2e 机）上跑 Playwright e2e，不可达再回退本机。
#
# 用法（仓库根或任意 cwd，脚本会定位 pier 根）：
#   bash scripts/e2e-runner/run-e2e.sh
#   bash scripts/e2e-runner/run-e2e.sh tests/e2e/startup-stability.spec.ts
#   bash scripts/e2e-runner/run-e2e.sh --local tests/e2e/git-review.spec.ts
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
#   PIER_E2E_ALLOW_DIRTY_REMOTE=1  允许在本机 dirty 时仍走远端（只测已提交 HEAD，
#                              不含未提交改动）。默认 dirty 时拒绝远端并提示 --local。
#   PIER_E2E_SKIP_SYNC=1       跳过「同步本机 HEAD 到远端」（仅调试用，易测错 commit）
#
# 远端默认会把仓库 checkout 到与本机相同的 git SHA（git bundle 补对象），
# 并在 SHA 变化或缺少 out/main 时自动 rebuild。
#
# 给 AI / 人类的约定见 AGENTS.md「E2E 执行优先级」。
#
set -euo pipefail

info() { printf '\033[1;34m[e2e-run]\033[0m %s\n' "$*"; }
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
ALLOW_DIRTY_REMOTE="${PIER_E2E_ALLOW_DIRTY_REMOTE:-0}"
SKIP_SYNC="${PIER_E2E_SKIP_SYNC:-0}"
# 远端默认 PATH（在远端 shell 里展开 $HOME / $PATH）
DEFAULT_REMOTE_PATH='${HOME}/.local/bin:/usr/local/opt/node@24/bin:/usr/local/opt/zig@0.15/bin:/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/zig@0.15/bin:/usr/local/bin:/opt/homebrew/bin:${PATH:-/usr/bin:/bin}'
REMOTE_PATH="${PIER_E2E_REMOTE_PATH:-}"

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
    --allow-dirty-remote)
      ALLOW_DIRTY_REMOTE=1
      shift
      ;;
    --skip-sync)
      SKIP_SYNC=1
      shift
      ;;
    --help|-h)
      sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'
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
  # 打印远端绝对路径到 stdout
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

# 把本机 HEAD 同步到远端仓库（fetch/checkout detach）。返回 0 成功。
sync_remote_to_local_head() {
  local local_sha remote_abs bundle_local bundle_remote
  local_sha="$(git rev-parse HEAD)"
  info "同步本机 HEAD ${local_sha:0:12} → 远端 ${SSH_HOST}"

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

  # 远端已有该对象则直接 checkout
  if remote_ssh "git -C $(printf %q "${remote_abs}") cat-file -t $(printf %q "${local_sha}")" >/dev/null 2>&1; then
    info "远端已有对象，checkout --detach ${local_sha:0:12}"
    remote_ssh "git -C $(printf %q "${remote_abs}") checkout --detach --force $(printf %q "${local_sha}")"
    return 0
  fi

  # 用 bundle 补对象：有共同祖先时用 base..HEAD；否则整 tip
  bundle_local="$(mktemp "${TMPDIR:-/tmp}/pier-e2e-bundle.XXXXXX")"
  bundle_remote="/tmp/pier-e2e-bundle-${local_sha:0:12}.bundle"
  # shellcheck disable=SC2064
  trap "rm -f $(printf %q "${bundle_local}")" RETURN

  info "远端缺少 commit，制作 git bundle…"
  remote_head="$(remote_ssh "git -C $(printf %q "${remote_abs}") rev-parse HEAD" 2>/dev/null || true)"
  if [ -n "${remote_head}" ] && git merge-base --is-ancestor "${remote_head}" "${local_sha}" 2>/dev/null; then
    git bundle create "${bundle_local}" "${remote_head}..${local_sha}"
  elif git rev-parse --verify "${local_sha}~100" >/dev/null 2>&1; then
    git bundle create "${bundle_local}" "${local_sha}~100..${local_sha}"
  else
    git bundle create "${bundle_local}" "${local_sha}"
  fi

  scp -o BatchMode=yes \
    -o ConnectTimeout="${CONNECT_TIMEOUT}" \
    -o ConnectionAttempts=1 \
    "${bundle_local}" \
    "${SSH_HOST}:${bundle_remote}"

  remote_ssh "set -euo pipefail
cd $(printf %q "${remote_abs}")
git fetch $(printf %q "${bundle_remote}") HEAD:refs/bundle/pier-e2e 2>/dev/null \
  || git fetch $(printf %q "${bundle_remote}") '+refs/*:refs/bundle/*' 2>/dev/null \
  || git bundle unbundle $(printf %q "${bundle_remote}")
# unbundle / fetch 后对象应在库中
if ! git cat-file -t $(printf %q "${local_sha}") >/dev/null 2>&1; then
  # 部分 fetch 只推进 ref；再试 unbundle 导入全部
  git bundle unbundle $(printf %q "${bundle_remote}") >/dev/null
fi
git checkout --detach --force $(printf %q "${local_sha}")
rm -f $(printf %q "${bundle_remote}")
"
  info "远端已 checkout ${local_sha:0:12}"
}

run_remote() {
  local local_sha pw_args_q rebuild_flag remote_path_payload

  local_sha="$(git rev-parse HEAD)"
  info "在闲置机执行 e2e via ssh ${SSH_HOST} (repo=${REMOTE_DIR} sha=${local_sha:0:12})"

  if [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then
    if [ "${ALLOW_DIRTY_REMOTE}" != "1" ]; then
      err "本机工作区有未提交变更：远端只会测已提交的 HEAD，不会带 dirty 文件。"
      err "请改用: bash scripts/e2e-runner/run-e2e.sh --local …"
      err "若确认只要测已提交 HEAD，可加 --allow-dirty-remote 或 PIER_E2E_ALLOW_DIRTY_REMOTE=1"
      return 2
    fi
    warn "本机 dirty，但已允许远端：仅测 HEAD ${local_sha:0:12}（不含未提交改动）"
  fi

  if [ "${SKIP_SYNC}" = "1" ]; then
    warn "PIER_E2E_SKIP_SYNC=1：跳过同步，远端可能不是本机 HEAD"
  else
    sync_remote_to_local_head || return 1
  fi

  pw_args_q=""
  if [ "${#PLAYWRIGHT_ARGS[@]}" -gt 0 ]; then
    pw_args_q=$(printf '%q ' "${PLAYWRIGHT_ARGS[@]}")
  fi

  rebuild_flag=0
  if [ "${REBUILD}" = "1" ]; then
    rebuild_flag=1
  fi

  # 远端 PATH：自定义则原样传入；默认用 DEFAULT_REMOTE_PATH（远端 eval 展开）
  if [ -n "${REMOTE_PATH}" ]; then
    remote_path_payload="${REMOTE_PATH}"
  else
    remote_path_payload="${DEFAULT_REMOTE_PATH}"
  fi

  # shellcheck disable=SC2087
  remote_ssh \
    env \
    "PIER_E2E_REBUILD=${rebuild_flag}" \
    "PIER_E2E_REMOTE_DIR=${REMOTE_DIR}" \
    "PIER_E2E_PW_ARGS=${pw_args_q}" \
    "PIER_E2E_EXPECT_SHA=${local_sha}" \
    "PIER_E2E_REMOTE_PATH=${remote_path_payload}" \
    bash -s <<'REMOTE'
set -euo pipefail

# PATH：支持 ${HOME}/${PATH} 占位（默认串）或调用方给的绝对路径列表
_path_template="${PIER_E2E_REMOTE_PATH}"
# shellcheck disable=SC2086
eval "export PATH=\"${_path_template}\""

if [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv 2>/dev/null)" || true
elif [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null)" || true
fi

_raw="${PIER_E2E_REMOTE_DIR:-pier}"
case "${_raw}" in
  /*) REMOTE_DIR="${_raw}" ;;
  "~/"*) REMOTE_DIR="${HOME}/${_raw#~/}" ;;
  "~") REMOTE_DIR="${HOME}" ;;
  *) REMOTE_DIR="${HOME}/${_raw}" ;;
esac
cd "${REMOTE_DIR}"

actual="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
echo "[e2e-run:remote] cwd=$(pwd) head=${actual:0:12} expect=${PIER_E2E_EXPECT_SHA:0:12} node=$(node -v 2>/dev/null) pnpm=$(pnpm -v 2>/dev/null)"

if [ -n "${PIER_E2E_EXPECT_SHA:-}" ] && [ "${actual}" != "${PIER_E2E_EXPECT_SHA}" ]; then
  echo "[e2e-run:remote] ERROR: HEAD ${actual} != expect ${PIER_E2E_EXPECT_SHA}" >&2
  exit 3
fi

build_marker=".pier-e2e-last-build-sha"
need_build=0
if [ "${PIER_E2E_REBUILD:-0}" = "1" ]; then
  need_build=1
elif [ ! -f out/main/index.js ]; then
  need_build=1
elif [ ! -f "${build_marker}" ] || [ "$(cat "${build_marker}" 2>/dev/null || true)" != "${actual}" ]; then
  need_build=1
elif [ ! -f native/build/Release/ghostty_native.node ]; then
  echo "[e2e-run:remote] WARN: missing native/build/Release/ghostty_native.node — still building electron; native may fail e2e" >&2
  need_build=1
fi

if [ "${need_build}" = "1" ]; then
  echo "[e2e-run:remote] plugins:pack + build:electron"
  pnpm plugins:pack
  pnpm build:electron
  printf '%s\n' "${actual}" > "${build_marker}"
else
  pnpm plugins:pack
fi

# shellcheck disable=SC2086
if [ -n "${PIER_E2E_PW_ARGS:-}" ]; then
  eval "pnpm exec playwright test --config playwright.config.ts ${PIER_E2E_PW_ARGS}"
else
  pnpm exec playwright test --config playwright.config.ts
fi
REMOTE
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
