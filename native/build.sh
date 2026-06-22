#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

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
npm install --ignore-scripts
npx --yes node-gyp rebuild --verbose

# Copy runtime deps next to .node
cp build_swift/libGhosttyBridge.dylib build/Release/ 2>/dev/null || true
if [ -d build_swift/GhosttyKit.framework ]; then
  cp -R build_swift/GhosttyKit.framework build/Release/
fi

echo "=== Done ==="
ls -lh build/Release/ghostty_native.node
