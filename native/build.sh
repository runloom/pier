#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Guard: GhosttyKit.xcframework 由 scripts/build-libghostty.sh 现地构建，
# 不入 git；缺失时明确报错并给出重建指令。避免 swift build 报难懂的
# "no such module 'libghostty'" 让人以为环境坏了。
if [ ! -d Vendor/libghostty-spm/GhosttyKit.xcframework ]; then
  cat >&2 <<'EOF'
ERROR: native/Vendor/libghostty-spm/GhosttyKit.xcframework 不存在。

首次 clone / 新电脑上第一次构建需要先跑：

    pnpm build:libghostty

该命令会拉 ghostty 上游 + Lakr233 patches + pier 独有 patch，本地构建
universal (arm64 + x86_64) fat archive。首次约 3-5 分钟；后续增量 60-90s。

依赖：
  - brew install zig@0.15
  - xcode-select --install
EOF
  exit 1
fi

echo "=== [1/3] SPM resolve + Swift build ==="
swift package resolve
swift build -c release --product GhosttyBridge

SWIFT_BUILD_DIR=$(swift build -c release --show-bin-path)
DYLIB="$SWIFT_BUILD_DIR/libGhosttyBridge.dylib"

if [ ! -f "$DYLIB" ]; then
  echo "ERROR: dylib not found at $DYLIB"
  exit 1
fi

echo "=== [2/3] Staging + rpath fixup ==="
mkdir -p build_swift
DYLIB_OUT="build_swift/libGhosttyBridge.dylib"
cp "$DYLIB" "$DYLIB_OUT"

# Find GhosttyKit.framework in SPM artifacts
FRAMEWORK=$(find .build/artifacts -name "GhosttyKit.framework" -type d | head -1)
if [ -n "$FRAMEWORK" ]; then
  rm -rf build_swift/GhosttyKit.framework
  cp -R "$FRAMEWORK" build_swift/
  echo "Copied GhosttyKit.framework"
fi

install_name_tool -id "@rpath/libGhosttyBridge.dylib" "$DYLIB_OUT" 2>/dev/null || true
install_name_tool -add_rpath "@loader_path" "$DYLIB_OUT" 2>/dev/null || true

echo "=== [3/3] node-gyp rebuild ==="
# --ignore-workspace: native/ 不在根 pnpm-workspace.yaml 的 packages 列表里, 不加这个
# flag pnpm 会把 native/ 当成 workspace 外目录, 不生成本地 pnpm-lock.yaml.
# --ignore-scripts: node-gyp 自带 install script, 这里只装依赖, 真正编译走下面那行.
pnpm install --ignore-workspace --ignore-scripts
pnpm exec node-gyp rebuild --verbose

# Copy runtime deps next to .node
cp build_swift/libGhosttyBridge.dylib build/Release/ 2>/dev/null || true
if [ -d build_swift/GhosttyKit.framework ]; then
  cp -R build_swift/GhosttyKit.framework build/Release/
fi

echo "=== Done ==="
ls -lh build/Release/ghostty_native.node
