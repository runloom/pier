#!/usr/bin/env bash
#
# 降低闲置 Mac 自动睡眠概率，避免 e2e / Actions runner 中途休眠。
# 需要管理员密码（sudo）。失败不阻断 setup-mac.sh。
#
set -euo pipefail

info() { printf '\033[1;34m[e2e-power]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[e2e-power]\033[0m %s\n' "$*" >&2; }

if [ "$(uname -s)" != "Darwin" ]; then
  warn "非 macOS，跳过"
  exit 0
fi

if ! command -v pmset >/dev/null 2>&1; then
  warn "无 pmset，跳过"
  exit 0
fi

info "当前 pmset -g:"
pmset -g | sed 's/^/  /' || true

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  if ! sudo -n true 2>/dev/null; then
    info "需要 sudo 修改电源（接电源时尽量不睡）..."
  fi
  SUDO="sudo"
fi

# 接电源：系统不睡；显示器可睡（省电，一般不影响 headless/已登录会话跑测）
# 电池：仍允许睡眠，避免笔记本离电掏干
$SUDO pmset -c sleep 0
$SUDO pmset -c disksleep 0
$SUDO pmset -c displaysleep 10
$SUDO pmset -c disablesleep 0 2>/dev/null || true

# 合盖：外接电源时尽量维持（机型/系统版本差异大，失败忽略）
$SUDO pmset -c tcpkeepalive 1 2>/dev/null || true

info "已写入接电源策略（sleep=0）。电池策略保持系统默认。"
info "建议：测试时接电；系统设置 → 锁定屏幕 → 关闭显示器可短、勿「注销」。"
info "更新后 pmset -g custom:"
pmset -g custom 2>/dev/null | sed 's/^/  /' || pmset -g | sed 's/^/  /'
