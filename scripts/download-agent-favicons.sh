#!/usr/bin/env bash
# 下载各 agent 的 favicon 到 src/renderer/components/agent-icons/favicons/<id>.png。
#
# Why: 运行时直接用 Google favicon service 会被 renderer 的 img-src CSP
# ('self' data:) 拦成空白（见 src/main/csp.ts）。把图标打包成本地资产后
# 离线可用、不受 CSP 限制。新增/更新 favicon agent 时跑此脚本重新生成。
#
# 数据源（每行：id source）：
#   - "<id> <domain>"          → Google favicon service（domain, 128×128）
#   - "<id> lobehub:<brand>"   → lobehub/lobe-icons CDN color PNG（原 640×640,
#                                下载后用 sips 缩到 128 与 Google 源统一）
#
# 注：openclaude.png 不在此脚本——它是手动维护的本地资产，不是 favicon 下载。
#
# Google 源的 domain 与 src/shared/agent-catalog.ts 各 entry 的 faviconDomain
# 保持一致；lobehub 源用 lobehub 仓的 brand slug（见 lobehub.com/icons/<id>）。
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/src/renderer/components/agent-icons/favicons"
mkdir -p "$DIR"

while IFS=' ' read -r id source; do
  [ -z "$id" ] && continue
  case "$source" in
    lobehub:*)
      brand="${source#lobehub:}"
      curl -sS -L -o "$DIR/$id.png" \
        "https://raw.githubusercontent.com/lobehub/lobe-icons/refs/heads/master/packages/static-png/light/${brand}-color.png"
      # lobehub 原图 640×640,缩到 128 与 Google 源统一（macOS sips；不可用则保留原图）。
      if command -v sips >/dev/null 2>&1; then
        sips -z 128 128 "$DIR/$id.png" >/dev/null 2>&1 || true
      fi
      ;;
    *)
      curl -sS -L -o "$DIR/$id.png" \
        "https://www.google.com/s2/favicons?domain=${source}&sz=128"
      ;;
  esac
  echo "✓ ${id} ← ${source}"
done <<'EOF'
opencode opencode.ai
cursor cursor.com
kimi moonshot.cn
amp ampcode.com
grok x.ai
mimo-code mimo.xiaomi.com
ante antigma.ai
antigravity antigravity.google
goose goose-docs.ai
kiro kiro.dev
crush charm.sh
aug augmentcode.com
autohand autohand.ai
cline cline.bot
codebuff codebuff.com
command-code commandcode.ai
continue continue.dev
mistral-vibe mistral.ai
qwen-code qwenlm.github.io
rovo atlassian.com
hermes nousresearch.com
openclaw openclaw.ai
devin devin.ai
codebuddy lobehub:codebuddy
qodercli lobehub:qoder
EOF

echo "Done. (openclaude.png 手动维护，不在此列。)"
