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

# --------- 目标 arch 解析 ---------
# NATIVE_ARCHS 默认 host arch（dev 快速迭代，只编本机能跑的切片）。
# 打 release dmg 时通过 `NATIVE_ARCHS="arm64 x86_64"` 强制 universal，
# 输出 fat .node / .dylib，可以同时喂给 arm64 dmg 和 x64 dmg。
#
# 命名：内部一律用 mach-o arch 名 (arm64 / x86_64)；只在跟 node-gyp
# 交涉时才转换成它的 alias (arm64 保留, x86_64 → x64)。
#
# 策略：逐 arch 走单 arch swift build（SPM 常规路径，靠谱），把每个
# arch 的 dylib 各自暂存，最后 lipo 合成 fat。
# 不走 xcodebuild 多 --arch 模式：那条路径处理带非标准命名的 .a
# (libghostty-universal.a) 的 xcframework 时会漏配 linker search path
# → "Library not found for -lghostty-universal"。
HOST_ARCH="$(uname -m)"
: "${NATIVE_ARCHS:=$HOST_ARCH}"
read -ra ARCH_LIST <<< "$NATIVE_ARCHS"
if [ ${#ARCH_LIST[@]} -eq 0 ]; then
  echo "ERROR: NATIVE_ARCHS 为空，需要至少一个 arch (arm64 或 x86_64)" >&2
  exit 1
fi
for arch in "${ARCH_LIST[@]}"; do
  case "$arch" in
    arm64|x86_64) ;;
    *)
      echo "ERROR: 不支持的 arch '$arch'，仅接受 arm64 / x86_64" >&2
      exit 1
      ;;
  esac
done

echo "=== [0/4] target arches: ${ARCH_LIST[*]} ==="

# --------- [1/4] swift build (per arch) ---------
echo "=== [1/4] SPM resolve + Swift build (per arch) ==="
swift package resolve

DYLIB_STAGED=()
FRAMEWORK_SRC=""
for arch in "${ARCH_LIST[@]}"; do
  echo "  → swift build --arch $arch"
  swift build -c release --product GhosttyBridge --arch "$arch"
  bin=$(swift build -c release --arch "$arch" --show-bin-path)
  src="$bin/libGhosttyBridge.dylib"
  if [ ! -f "$src" ]; then
    echo "ERROR: dylib not found at $src" >&2
    exit 1
  fi
  dst="build_swift/libGhosttyBridge-$arch.dylib"
  mkdir -p build_swift
  cp "$src" "$dst"
  DYLIB_STAGED+=("$dst")
  # Framework 到手一次就够 (universal xcframework 里同一份)
  if [ -z "$FRAMEWORK_SRC" ]; then
    FRAMEWORK_SRC=$(find .build/artifacts -name "GhosttyKit.framework" -type d | head -1 || true)
  fi
done

echo "=== [2/4] Staging + lipo + rpath fixup ==="
DYLIB_OUT="build_swift/libGhosttyBridge.dylib"
if [ ${#DYLIB_STAGED[@]} -eq 1 ]; then
  cp "${DYLIB_STAGED[0]}" "$DYLIB_OUT"
else
  echo "  → lipo -create → universal libGhosttyBridge.dylib"
  lipo -create "${DYLIB_STAGED[@]}" -output "$DYLIB_OUT"
fi
rm -f "${DYLIB_STAGED[@]}"

if [ -n "$FRAMEWORK_SRC" ]; then
  rm -rf build_swift/GhosttyKit.framework
  cp -R "$FRAMEWORK_SRC" build_swift/
  echo "Copied GhosttyKit.framework from $FRAMEWORK_SRC"
fi

install_name_tool -id "@rpath/libGhosttyBridge.dylib" "$DYLIB_OUT" 2>/dev/null || true
install_name_tool -add_rpath "@loader_path" "$DYLIB_OUT" 2>/dev/null || true

echo "  → dylib arches: $(lipo -archs "$DYLIB_OUT" 2>/dev/null || echo unknown)"

# --------- [3/4] node-gyp rebuild (per arch → lipo) ---------
# node-gyp 一次只能一 arch。逐 arch build，产物暂存到 build/ghostty_native-<arch>.node，
# 最后 lipo 合成 universal 落回 build/Release/ghostty_native.node。
# --ignore-workspace: native/ 不在根 pnpm-workspace.yaml 的 packages 列表里, 不加这个
# flag pnpm 会把 native/ 当成 workspace 外目录, 不生成本地 pnpm-lock.yaml.
echo "=== [3/4] node-gyp rebuild ==="
pnpm install --ignore-workspace --ignore-scripts

# 每次 node-gyp rebuild 会 rm -rf build/，暂存目录必须放在 build/ 之外，否则
# 上一轮 arch 的产物会被下一轮清掉。
STAGE_DIR=".build-per-arch"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

NODE_STAGED=()
for arch in "${ARCH_LIST[@]}"; do
  case "$arch" in
    arm64) gyp_arch=arm64 ;;
    x86_64) gyp_arch=x64 ;;
  esac
  echo "  → node-gyp --arch=$gyp_arch"
  pnpm exec node-gyp rebuild --verbose --arch="$gyp_arch"
  staged="$STAGE_DIR/ghostty_native-$arch.node"
  cp build/Release/ghostty_native.node "$staged"
  NODE_STAGED+=("$staged")
done

if [ ${#NODE_STAGED[@]} -gt 1 ]; then
  echo "  → lipo -create → universal ghostty_native.node"
  lipo -create "${NODE_STAGED[@]}" -output build/Release/ghostty_native.node
fi
rm -rf "$STAGE_DIR"
echo "  → addon arches: $(lipo -archs build/Release/ghostty_native.node 2>/dev/null || echo unknown)"

# --------- [4/4] copy runtime deps ---------
echo "=== [4/4] copy runtime deps to build/Release ==="
cp build_swift/libGhosttyBridge.dylib build/Release/ 2>/dev/null || true
if [ -d build_swift/GhosttyKit.framework ]; then
  cp -R build_swift/GhosttyKit.framework build/Release/
fi

echo "=== Done ==="
ls -lh build/Release/ghostty_native.node build/Release/libGhosttyBridge.dylib
