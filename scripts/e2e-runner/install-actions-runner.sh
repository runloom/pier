#!/usr/bin/env bash
#
# 在闲置 Mac 上安装 GitHub Actions self-hosted runner（标签: self-hosted, macOS, pier-e2e）
#
# 用法（在 pier 仓库根或任意目录）：
#
#   # A. 本机已 gh auth login 且对 runloom/pier 有 admin：
#   bash scripts/e2e-runner/install-actions-runner.sh
#
#   # B. 从主力机生成 token 后拷过来：
#   #   gh api -X POST repos/runloom/pier/actions/runners/registration-token --jq .token
#   RUNNER_TOKEN=xxxx bash scripts/e2e-runner/install-actions-runner.sh
#
# 环境变量：
#   RUNNER_DIR     默认 ~/actions-runner
#   RUNNER_REPO    默认 runloom/pier
#   RUNNER_NAME    默认 pier-e2e-$(hostname -s)
#   RUNNER_LABELS  默认 self-hosted,macOS,pier-e2e
#   RUNNER_TOKEN   可选；缺省则 gh api 申请
#
set -euo pipefail

info() { printf '\033[1;34m[e2e-runner]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[e2e-runner]\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31m[e2e-runner]\033[0m %s\n' "$*" >&2; }

if [ "$(uname -s)" != "Darwin" ]; then
  err "仅支持 macOS"
  exit 1
fi

RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"
RUNNER_REPO="${RUNNER_REPO:-runloom/pier}"
RUNNER_NAME="${RUNNER_NAME:-pier-e2e-$(scutil --get LocalHostName 2>/dev/null || hostname -s)}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,macOS,pier-e2e}"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) RUNNER_ARCH="arm64" ;;
  x86_64) RUNNER_ARCH="x64" ;;
  *) err "不支持的架构: $ARCH"; exit 1 ;;
esac

# 解析最新 runner 下载 URL（避免写死版本）
resolve_runner_tarball() {
  local api_url="https://api.github.com/repos/actions/runner/releases/latest"
  local asset_name
  asset_name=$(curl -fsSL "$api_url" | python3 -c "
import json,sys
data=json.load(sys.stdin)
want='actions-runner-osx-${RUNNER_ARCH}-'
for a in data.get('assets',[]):
    n=a.get('name','')
    if n.startswith(want) and n.endswith('.tar.gz'):
        print(n)
        print(a['browser_download_url'])
        break
else:
    sys.exit(1)
")
  # shellcheck disable=SC2086
  set -- $asset_name
  RUNNER_TGZ_NAME=$1
  RUNNER_TGZ_URL=$2
}

info "解析最新 actions/runner macOS ${RUNNER_ARCH} 包..."
resolve_runner_tarball
info "下载: ${RUNNER_TGZ_NAME}"

mkdir -p "${RUNNER_DIR}"
cd "${RUNNER_DIR}"

if [ ! -f ./config.sh ]; then
  curl -fsSL -o "${RUNNER_TGZ_NAME}" "$RUNNER_TGZ_URL"
  tar xzf "${RUNNER_TGZ_NAME}"
  rm -f "${RUNNER_TGZ_NAME}"
else
  info "已存在 runner 文件于 ${RUNNER_DIR}，跳过下载"
fi

if [ -z "${RUNNER_TOKEN:-}" ]; then
  if ! command -v gh >/dev/null 2>&1; then
    err "需要 RUNNER_TOKEN 或已安装并 gh auth login 的 gh"
    exit 1
  fi
  if ! gh auth status >/dev/null 2>&1; then
    err "gh 未登录。请: gh auth login"
    err "或从有权限的机器生成 token："
    err "  gh api -X POST repos/${RUNNER_REPO}/actions/runners/registration-token --jq .token"
    exit 1
  fi
  info "申请 registration token（${RUNNER_REPO}）..."
  RUNNER_TOKEN="$(gh api -X POST "repos/${RUNNER_REPO}/actions/runners/registration-token" --jq .token)"
fi

if [ -f .runner ]; then
  warn "已配置过 runner（存在 .runner）。若要重装: ./config.sh remove && 重跑本脚本"
else
  info "config.sh --url https://github.com/${RUNNER_REPO} --name ${RUNNER_NAME} --labels ${RUNNER_LABELS}"
  ./config.sh \
    --unattended \
    --url "https://github.com/${RUNNER_REPO}" \
    --token "$RUNNER_TOKEN" \
    --name "${RUNNER_NAME}" \
    --labels "${RUNNER_LABELS}" \
    --work "_work" \
    --replace
fi

# 用户级 LaunchAgent 常驻（无需 root svc）
# launchd 默认 PATH 只有 /usr/bin:/bin:…，必须注入 brew/node/pnpm，否则 job 里找不到工具
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST="${PLIST_DIR}/com.github.actions.runner.pier-e2e.plist"
mkdir -p "$PLIST_DIR"

# 即使目录尚未存在也保留常见 brew 前缀（装机顺序容错）
RUNNER_PATH="${HOME}/.local/bin:/usr/local/opt/node@24/bin:/usr/local/opt/zig@0.15/bin:/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/zig@0.15/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# 用 run.sh 循环；KeepAlive 在异常退出时拉起；ThrottleInterval 避免配置错误 thrash
cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.github.actions.runner.pier-e2e</string>
  <key>WorkingDirectory</key>
  <string>${RUNNER_DIR}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RUNNER_DIR}/run.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${RUNNER_PATH}</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${RUNNER_DIR}/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${RUNNER_DIR}/launchd.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/com.github.actions.runner.pier-e2e" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/com.github.actions.runner.pier-e2e" 2>/dev/null || true

info "runner 已配置并尝试通过 LaunchAgent 启动"
info "目录: ${RUNNER_DIR}"
info "名称: ${RUNNER_NAME}"
info "标签: ${RUNNER_LABELS}"
info "LaunchAgent PATH: ${RUNNER_PATH}"
info "日志: ${RUNNER_DIR}/launchd.out.log / launchd.err.log"
info "仓库检查: https://github.com/${RUNNER_REPO}/settings/actions/runners"
info "手动前台调试: cd ${RUNNER_DIR} && ./run.sh"
info "触发 workflow: gh workflow run e2e-self-hosted.yml"
