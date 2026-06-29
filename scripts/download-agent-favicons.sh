#!/usr/bin/env bash
# 下载各 agent 的 favicon 到 src/renderer/components/agent-icons/favicons/<id>.png。
#
# Why: 运行时直接用 Google favicon service 会被 renderer 的 img-src CSP
# ('self' data:) 拦成空白（见 src/main/csp.ts）。把图标打包成本地资产后
# 离线可用、不受 CSP 限制。新增/更新 favicon agent 时跑此脚本重新生成。
#
# 注：openclaude.png 不在此脚本——它是 orca resources/openclaude-logo.png
# 的副本（手动维护），不是 favicon 下载。
#
# 数据源与 src/shared/agent-catalog.ts 各 entry 的 faviconDomain 保持一致。
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/src/renderer/components/agent-icons/favicons"
mkdir -p "$DIR"

while IFS=' ' read -r id domain; do
  [ -z "$id" ] && continue
  curl -sS -L -o "$DIR/$id.png" \
    "https://www.google.com/s2/favicons?domain=${domain}&sz=128"
  echo "✓ ${id} ← ${domain}"
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
EOF

echo "Done. (openclaude.png 由 orca 资产手动维护，不在此列。)"
