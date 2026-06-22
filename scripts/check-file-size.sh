#!/usr/bin/env bash
# Pier 上帝文件防御 (详 .pier/standards/dev-setup.md §5)
#
# 阈值:
#   ≤ 300 lines: ✓
#   301-500: ⚠ warn (此脚本 print 但 exit 0)
#   > 500:   ✗ reject (exit 1)
#
# 用法: bash scripts/check-file-size.sh

set -e

SOFT_CAP=300
HARD_CAP=500

# 仅检查 src/ 内 .ts/.tsx (tests/ 内 fixture 可能合理大)
# 排除:
#   - .d.ts (type 声明)
#   - *.test.{ts,tsx} / *.spec.{ts,tsx} (test 内可能 inline 大块 fixture)
#   - components/primitives/** (shadcn add 生成的 vendored 代码, 类似 3rd-party lib)
FILES=$(find src -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -not -name '*.d.ts' \
  -not -name '*.test.ts' \
  -not -name '*.test.tsx' \
  -not -name '*.spec.ts' \
  -not -name '*.spec.tsx' \
  -not -path '*/components/primitives/*' \
  2>/dev/null)

WARN_LIST=""
REJECT_LIST=""

for f in $FILES; do
  lines=$(wc -l < "$f" | tr -d ' ')
  if [ "$lines" -gt "$HARD_CAP" ]; then
    REJECT_LIST="$REJECT_LIST\n  ✗ $f: $lines lines (hard cap $HARD_CAP)"
  elif [ "$lines" -gt "$SOFT_CAP" ]; then
    WARN_LIST="$WARN_LIST\n  ⚠ $f: $lines lines (soft cap $SOFT_CAP)"
  fi
done

if [ -n "$WARN_LIST" ]; then
  echo "⚠ 接近上帝文件 (考虑拆模块):"
  echo -e "$WARN_LIST"
  echo ""
fi

if [ -n "$REJECT_LIST" ]; then
  echo "✗ 上帝文件 (必拆, 见 dev-setup.md §5 文件大小限制):"
  echo -e "$REJECT_LIST"
  echo ""
  echo "拆分建议:"
  echo "  - React component: 拆 sub-component / hooks"
  echo "  - store: 按业务域拆 slice"
  echo "  - service: 按职责拆 helper module"
  exit 1
fi

echo "✓ file size check pass (soft cap $SOFT_CAP / hard cap $HARD_CAP)"
