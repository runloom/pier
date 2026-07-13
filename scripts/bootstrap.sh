#!/usr/bin/env bash
#
# 新机 / 新 clone 首次启动一键脚本。做完这一个命令 pier 就能 `pnpm dev` 起来。
#
# 触发流程：
#   1. 依赖预检（brew / zig 0.15 / Xcode CLI Tools / pnpm）
#   2. pnpm install（如需）
#   3. pnpm setup:worktree —— 会自动拉 GhosttyKit.xcframework（若缺）
#      + 编译 native addon
#
# 用法：
#   bash scripts/bootstrap.sh          # 交互模式，缺依赖时会问要不要装
#   BOOTSTRAP_YES=1 bash scripts/bootstrap.sh   # CI / 无交互，缺依赖直接装
#
# 幂等：所有步骤都能重跑，已装的会被跳过。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PIER_ROOT"

BOOTSTRAP_YES="${BOOTSTRAP_YES:-0}"

info() { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[bootstrap]\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; }

confirm() {
    # BOOTSTRAP_YES=1 直接返 0；否则读一行，y/yes 是通过
    local prompt=$1
    if [ "$BOOTSTRAP_YES" = "1" ]; then
        info "$prompt (BOOTSTRAP_YES=1，自动 yes)"
        return 0
    fi
    read -r -p "$prompt [y/N] " ans
    case "$ans" in
        y | Y | yes | YES) return 0 ;;
        *) return 1 ;;
    esac
}

# ---------- 平台前置 ----------
if [ "$(uname -s)" != "Darwin" ]; then
    err "pier 目前只支持 macOS（Ghostty native + Swift）"
    exit 1
fi

# ---------- Xcode CLI Tools ----------
info "检查 Xcode Command Line Tools..."
if ! xcode-select -p >/dev/null 2>&1; then
    err "Xcode CLI Tools 未安装。请手动运行："
    err "    xcode-select --install"
    err "装完再重跑本脚本。"
    exit 1
fi
info "Xcode CLI Tools OK ($(xcode-select -p))"

# ---------- Homebrew ----------
info "检查 Homebrew..."
if ! command -v brew >/dev/null 2>&1; then
    err "Homebrew 未安装。请从 https://brew.sh 装完再重跑本脚本。"
    exit 1
fi
info "brew OK ($(brew --version | head -1))"

# ---------- zig 0.15 ----------
# Apple Silicon brew 在 /opt/homebrew，Intel brew 在 /usr/local，探测两条路径。
ZIG_BIN=""
for candidate in \
    /opt/homebrew/opt/zig@0.15/bin/zig \
    /usr/local/opt/zig@0.15/bin/zig; do
    if [ -x "$candidate" ]; then
        ZIG_BIN="$candidate"
        break
    fi
done
info "检查 zig 0.15..."
if [ -z "$ZIG_BIN" ]; then
    warn "未找到 zig 0.15（/opt/homebrew 和 /usr/local 均未装）"
    if confirm "允许自动 brew install zig@0.15?"; then
        brew install zig@0.15
        # 装完再探测一次
        for candidate in \
            /opt/homebrew/opt/zig@0.15/bin/zig \
            /usr/local/opt/zig@0.15/bin/zig; do
            if [ -x "$candidate" ]; then
                ZIG_BIN="$candidate"
                break
            fi
        done
    else
        err "跳过 zig 安装，后续 build:libghostty 会失败"
        exit 1
    fi
fi
ZIG_VER=$("$ZIG_BIN" version 2>/dev/null || echo unknown)
case "$ZIG_VER" in
    0.15.*) info "zig 0.15 OK ($ZIG_VER)" ;;
    *)
        err "zig 版本 $ZIG_VER 不匹配 0.15.x"
        exit 1
        ;;
esac

# ---------- pnpm ----------
info "检查 pnpm..."
if ! command -v pnpm >/dev/null 2>&1; then
    warn "pnpm 未安装"
    if confirm "允许自动 brew install pnpm?"; then
        brew install pnpm
    else
        err "跳过 pnpm 安装。pier 需要 pnpm 10+"
        exit 1
    fi
fi
PNPM_VER=$(pnpm --version 2>/dev/null || echo unknown)
info "pnpm OK ($PNPM_VER)"

# ---------- Node ----------
info "检查 Node..."
if ! command -v node >/dev/null 2>&1; then
    err "Node 未装。pier 需要 Node 22+。推荐 nvm/fnm/mise 装。"
    exit 1
fi
NODE_VER=$(node --version)
info "node OK ($NODE_VER)"

# ---------- pnpm install ----------
info "pnpm install..."
# pnpm 11 会把 workspace 绝对路径写入 node_modules 状态。旧版
# setup 创建的主仓软链在 pnpm install 前必须先迁移，否则 pnpm 会
# 尝试清理主仓的共享目录。直接跑 Node 脚本可避开 pnpm run 的前置校验。
if [[ -L node_modules ]]; then
    node scripts/setup-worktree.mjs
else
    pnpm install
fi

# ---------- setup:worktree（含 xcframework + native addon 构建）----------
# 该步骤内部会：
#   1. 建立 worktree 本地 node_modules 布局（包内容复用 pnpm store）
#   2. 检测并 build GhosttyKit.xcframework（首次约 3-5 min）
#   3. 编译 native addon（约 30-60s）
info "跑 setup:worktree（首次含 libghostty universal 构建 + native 编译，约 5 分钟）..."
pnpm setup:worktree

# ---------- 收工 ----------
cat <<'EOF'

============================================================
[bootstrap] 完成。下一步：
    pnpm dev              # 起 Electron dev

其他常用命令：
    pnpm build:libghostty # 重建 xcframework（改了 patches 之后）
    pnpm build:native     # 重建 native addon（改了 Swift/addon.mm 之后）
    pnpm lint:fix         # 自动修 lint（pre-commit 拦下时用）
    pnpm typecheck        # tsc --noEmit
============================================================
EOF
