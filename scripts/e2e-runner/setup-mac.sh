#!/usr/bin/env bash
#
# 闲置 Mac（干净系统）→ Pier E2E runner 环境一键配置
#
# 在「闲置笔记本」本机 Terminal 执行（不要在主力机上跑）：
#
#   # 若仓库尚未 clone：
#   git clone git@github.com:runloom/pier.git ~/pier
#   cd ~/pier
#   bash scripts/e2e-runner/setup-mac.sh
#
# 无交互（推荐）：
#   BOOTSTRAP_YES=1 bash scripts/e2e-runner/setup-mac.sh
#
# 可选环境变量：
#   PIER_E2E_REPO_DIR   默认 ~/pier（若当前已在仓库内则用仓库根）
#   PIER_E2E_SKIP_BUILD=1   跳过 build:electron 冒烟
#   PIER_E2E_SKIP_E2E_SMOKE=1  跳过极短 e2e 冒烟
#   PIER_E2E_INSTALL_RUNNER=1  配置完后继续装 GitHub Actions self-hosted runner
#
# 人类必须先完成（脚本无法代劳）：
#   1. macOS 初始设置 + 登录图形桌面（不要停在登录窗口）
#   2. xcode-select --install 并等装完
#   3. 安装 Homebrew（https://brew.sh）
#   4. （若要从主力机远程接管）系统设置 → 通用 → 共享 → 远程登录 ON
#
set -euo pipefail

info() { printf '\033[1;34m[e2e-runner]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[e2e-runner]\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31m[e2e-runner]\033[0m %s\n' "$*" >&2; }

if [ "$(uname -s)" != "Darwin" ]; then
  err "仅支持 macOS"
  exit 1
fi

export BOOTSTRAP_YES="${BOOTSTRAP_YES:-1}"
export NONINTERACTIVE="${NONINTERACTIVE:-1}"

# ---------- 定位仓库根 ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/../bootstrap.sh" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
elif [ -n "${PIER_E2E_REPO_DIR:-}" ]; then
  REPO_ROOT="$(cd "$PIER_E2E_REPO_DIR" && pwd)"
elif [ -d "${HOME}/pier/.git" ]; then
  REPO_ROOT="$(cd "${HOME}/pier" && pwd)"
else
  err "找不到 pier 仓库。请先："
  err "  git clone git@github.com:runloom/pier.git ~/pier && cd ~/pier"
  err "  bash scripts/e2e-runner/setup-mac.sh"
  exit 1
fi
cd "$REPO_ROOT"
info "仓库根: $REPO_ROOT"

# ---------- 前置：Xcode CLI / Homebrew ----------
info "检查 Xcode Command Line Tools..."
if ! xcode-select -p >/dev/null 2>&1; then
  err "未安装 Xcode CLI Tools。请在本机执行后重跑："
  err "  xcode-select --install"
  exit 1
fi
info "Xcode CLI OK ($(xcode-select -p))"

info "检查 Homebrew..."
if ! command -v brew >/dev/null 2>&1; then
  err "未安装 Homebrew。请先安装 https://brew.sh 后重跑。"
  exit 1
fi
# Apple Silicon / Intel
if [ -x /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi
info "brew OK ($(brew --version | head -1))"

# ---------- 工具链 ----------
install_brew_pkg() {
  local formula=$1
  if brew list --formula "$formula" >/dev/null 2>&1 || brew list --cask "$formula" >/dev/null 2>&1; then
    info "已安装: $formula"
    return 0
  fi
  info "brew install $formula ..."
  brew install "$formula"
}

info "安装/确认依赖（git, gh, node@24, zig@0.15）..."
install_brew_pkg git
install_brew_pkg gh
# 不依赖 brew pnpm：较新 brew pnpm 会拒绝 packageManager=pnpm@11.12.0。
# 项目锁定版本由 ensure_project_pnpm 装到 ~/.local-pnpm-e2e。
install_brew_pkg zig@0.15

# Node 24：始终优先 brew node@24（已有旧 node 18/20 时也要装并前置 PATH）
ensure_node24() {
  local prefix=""
  if brew info node@24 >/dev/null 2>&1; then
    install_brew_pkg node@24
    prefix="$(brew --prefix node@24 2>/dev/null || true)"
  else
    install_brew_pkg node
    prefix="$(brew --prefix node 2>/dev/null || true)"
  fi
  if [ -n "$prefix" ] && [ -d "${prefix}/bin" ]; then
    export PATH="${prefix}/bin:$PATH"
    if ! grep -q 'node@24\|Pier e2e-runner: Node' "${HOME}/.zprofile" 2>/dev/null; then
      {
        echo ''
        echo '# Pier e2e-runner: Node 24'
        echo "export PATH=\"${prefix}/bin:\$PATH\""
      } >>"${HOME}/.zprofile"
    fi
  fi
}

NODE_VER_NOW="$(node --version 2>/dev/null || echo v0)"
NODE_MAJOR_NOW="${NODE_VER_NOW#v}"
NODE_MAJOR_NOW="${NODE_MAJOR_NOW%%.*}"
if ! command -v node >/dev/null 2>&1 || [ "${NODE_MAJOR_NOW:-0}" -lt 24 ]; then
  info "需要 Node 24+（当前: ${NODE_VER_NOW}）→ 安装/启用 node@24"
  ensure_node24
else
  info "node 已满足: $(node --version)"
  # 仍前置 node@24 前缀，避免 PATH 上更旧的 node 抢先
  if [ -d "$(brew --prefix node@24 2>/dev/null)/bin" ]; then
    export PATH="$(brew --prefix node@24)/bin:$PATH"
  fi
fi

# zig@0.15 常不在默认 PATH
for candidate in \
  /opt/homebrew/opt/zig@0.15/bin \
  /usr/local/opt/zig@0.15/bin; do
  if [ -d "$candidate" ]; then
    export PATH="$candidate:$PATH"
    if ! grep -q 'zig@0.15' "${HOME}/.zprofile" 2>/dev/null; then
      {
        echo ''
        echo '# Pier e2e-runner: zig 0.15'
        echo "export PATH=\"$candidate:\$PATH\""
      } >>"${HOME}/.zprofile"
    fi
    break
  fi
done

info "版本快照: node=$(node --version 2>/dev/null || echo missing) pnpm=$(pnpm --version 2>/dev/null || echo missing) zig=$(zig version 2>/dev/null || echo missing) gh=$(gh --version 2>/dev/null | head -1 || echo missing)"

NODE_VER=$(node --version 2>/dev/null || echo v0)
NODE_MAJOR=${NODE_VER#v}
NODE_MAJOR=${NODE_MAJOR%%.*}
if [ "${NODE_MAJOR:-0}" -lt 24 ]; then
  err "需要 Node 24+，当前 $NODE_VER。请: brew install node@24 && brew link node@24 --force --overwrite"
  exit 1
fi

# 按 package.json#packageManager 安装 pnpm 到独立 prefix（避开 brew 新版本互斥）
ensure_project_pnpm() {
  local want raw ver prefix
  want=""
  if [ -f package.json ]; then
    raw="$(node -p "try{require('./package.json').packageManager||''}catch(e){''}" 2>/dev/null || true)"
    case "${raw}" in
      pnpm@*) want="${raw#pnpm@}" ;;
    esac
    want="${want%%+*}"
  fi
  if [ -z "${want}" ]; then
    want="11.12.0"
  fi
  prefix="${HOME}/.local-pnpm-e2e"
  ver="$("${prefix}/bin/pnpm" -v 2>/dev/null || true)"
  if [ "${ver}" != "${want}" ]; then
    info "安装 pnpm@${want} → ${prefix}"
    mkdir -p "${prefix}"
    npm install -g "pnpm@${want}" --prefix "${prefix}"
  fi
  export PATH="${prefix}/bin:${PATH}"
  hash -r 2>/dev/null || true
  info "pnpm $(pnpm -v)（project packageManager）"
  if ! grep -q 'local-pnpm-e2e\|Pier e2e-runner: pnpm' "${HOME}/.zprofile" 2>/dev/null; then
    {
      echo ''
      echo '# Pier e2e-runner: project-locked pnpm'
      echo "export PATH=\"${prefix}/bin:\$PATH\""
    } >>"${HOME}/.zprofile"
  fi
}
ensure_project_pnpm

# ---------- 电源：尽量不睡（需要 sudo，失败只警告）----------
POWER_SCRIPT="$REPO_ROOT/scripts/e2e-runner/configure-power.sh"
if [ -x "$POWER_SCRIPT" ] || [ -f "$POWER_SCRIPT" ]; then
  info "配置电源（防睡眠）..."
  bash "$POWER_SCRIPT" || warn "电源配置失败（可稍后 sudo bash scripts/e2e-runner/configure-power.sh）"
fi

# ---------- 仓库依赖与 native ----------
info "BOOTSTRAP_YES=$BOOTSTRAP_YES → scripts/bootstrap.sh"
bash "$REPO_ROOT/scripts/bootstrap.sh"

# ---------- 构建冒烟（Electron e2e 前置）----------
if [ "${PIER_E2E_SKIP_BUILD:-0}" != "1" ]; then
  info "pnpm build:electron（e2e 需要 out/main）..."
  pnpm build:electron
else
  warn "跳过 build:electron（PIER_E2E_SKIP_BUILD=1）"
fi

# ---------- 极短 e2e 冒烟（可选）----------
if [ "${PIER_E2E_SKIP_E2E_SMOKE:-0}" != "1" ]; then
  if [ -f tests/e2e/startup-stability.spec.ts ]; then
    info "e2e 冒烟: startup-stability（会短暂弹出 Pier 测试窗，属正常）..."
    pnpm exec playwright test --config playwright.config.ts tests/e2e/startup-stability.spec.ts || {
      warn "冒烟 e2e 失败——环境可能仍缺 GUI 权限/登录会话。请确认已登录桌面后重跑。"
      warn "完整套件可稍后: pnpm test:e2e"
    }
  else
    warn "未找到 startup-stability.spec.ts，跳过冒烟"
  fi
else
  warn "跳过 e2e 冒烟（PIER_E2E_SKIP_E2E_SMOKE=1）"
fi

# ---------- 可选：GitHub Actions runner ----------
if [ "${PIER_E2E_INSTALL_RUNNER:-0}" = "1" ]; then
  info "安装 GitHub Actions self-hosted runner..."
  bash "$REPO_ROOT/scripts/e2e-runner/install-actions-runner.sh"
fi

# ---------- SSH 提示 ----------
REMOTE_LOGIN_STATUS="$(systemsetup -getremotelogin 2>/dev/null || true)"
info "远程登录状态: ${REMOTE_LOGIN_STATUS:-unknown（无 systemsetup 权限时请到「共享」面板查看）}"

IP_GUESS="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
HOSTNAME_GUESS="$(scutil --get LocalHostName 2>/dev/null || hostname)"

cat <<EOF

============================================================
[e2e-runner] 环境配置完成

仓库:     $REPO_ROOT
本机名:   $HOSTNAME_GUESS
局域网IP: ${IP_GUESS:-（未取到，可在「系统设置 → 网络」查看）}

主力机 ~/.ssh/config 示例（在主力机配置，不是本机）:
  Host pier-e2e
    HostName ${IP_GUESS:-<本机局域网IP>}
    User $(whoami)
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes

主力机验证 / 跑 e2e:
  ssh -o BatchMode=yes pier-e2e 'echo ok'
  # 在 pier 仓库:
  pnpm test:e2e:auto
  # 或: bash scripts/e2e-runner/run-e2e.sh

装 GitHub self-hosted runner（在本机仓库根）:
  bash scripts/e2e-runner/install-actions-runner.sh
  # 短时 token: RUNNER_TOKEN=... bash scripts/e2e-runner/install-actions-runner.sh
  # 也可在 setup 时: PIER_E2E_INSTALL_RUNNER=1 bash scripts/e2e-runner/setup-mac.sh

本机手动全量:
  cd $REPO_ROOT && pnpm test:e2e
============================================================
EOF
