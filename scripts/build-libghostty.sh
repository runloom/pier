#!/usr/bin/env bash
#
# 从 ghostty 上游 + Lakr233 patches + pier patches 构建 GhosttyKit.xcframework
# （universal macos-arm64_x86_64）。产出安装到
# `native/Vendor/libghostty-spm/GhosttyKit.xcframework/`。
#
# 依赖（会做前置检查）：
#   brew install zig@0.15           # 硬要求 zig 0.15.2，跟 ghostty 上游对齐
#   xcode-select --install          # Xcode CLI Tools
#
# 首次运行会 clone 两个仓到 pier 根下的 gitignored 位置：
#   .ghostty-src/       ghostty-org/ghostty 源
#   .libghostty-spm-src/ Lakr233/libghostty-spm （复用他的 patch + build 脚本）
#
# 幂等：重跑会 reset 到 pinned tag → 重 apply 所有 patches → 重 build。
#
# 已知问题绕过：
#   - Xcode 26.6 libtool 静默丢 8 字节未对齐的 .o 文件 → 用 `ar rcs` 手工
#     合并每个 arch 的 fat archive，绕过 libtool
#   - Zig 0.15 lazy dependency：首次 clone 后 zig build 会 fetch 40+ 依赖
#     tarball（oniguruma/libpng/highway/freetype 等），耗时 60-120s
#
# 首次运行总耗时：3-5 分钟（含 fetch）；后续增量：60-90s
#
# 环境变量：
#   GHOSTTY_TAG           覆盖默认 ghostty tag（默认跟随 pier 仓内 pinned 值）
#   LAKR_TAG              覆盖 Lakr233 libghostty-spm tag
#   ZIG                   覆盖 zig 路径（默认 /opt/homebrew/opt/zig@0.15/bin/zig）

set -euo pipefail

# --------- 路径 ---------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
GHOSTTY_SRC="${PIER_ROOT}/.ghostty-src"
LAKR_SRC="${PIER_ROOT}/.libghostty-spm-src"
PIER_PATCHES="${PIER_ROOT}/native/Vendor/libghostty-spm/Patches/ghostty"
OUTPUT_XCF="${PIER_ROOT}/native/Vendor/libghostty-spm/GhosttyKit.xcframework"
HEADERS_STAGING="${PIER_ROOT}/.libghostty-build-tmp/headers"

# --------- pinned 版本 ---------
: "${GHOSTTY_TAG:=v1.3.1}"
: "${LAKR_TAG:=storage.1.2.8}"
# Zig 路径：优先环境变量，其次遍历 Apple Silicon / Intel brew 前缀，最后回退到 PATH。
if [ -z "${ZIG:-}" ]; then
    for candidate in \
        /opt/homebrew/opt/zig@0.15/bin/zig \
        /usr/local/opt/zig@0.15/bin/zig \
        "$(command -v zig 2>/dev/null || true)"; do
        if [ -n "$candidate" ] && [ -x "$candidate" ]; then
            ZIG="$candidate"
            break
        fi
    done
fi
: "${ZIG:=/opt/homebrew/opt/zig@0.15/bin/zig}"

# --------- 依赖前置检查 ---------
require_cmd() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "[!] 缺依赖：$1"
        echo "    $2"
        exit 1
    }
}

if [ ! -x "$ZIG" ]; then
    echo "[!] 缺依赖：zig 0.15（预期在 $ZIG）"
    echo "    brew install zig@0.15"
    exit 1
fi

ZIG_VER=$("$ZIG" version)
case "$ZIG_VER" in
    0.15.*) ;;
    *) echo "[!] zig 版本 $ZIG_VER 不匹配，需要 0.15.x"; exit 1 ;;
esac

require_cmd git "系统 git"
require_cmd xcodebuild "xcode-select --install"
require_cmd xcrun "xcode-select --install"
require_cmd lipo "xcode-select --install"
require_cmd ar "xcode-select --install"
require_cmd ranlib "xcode-select --install"
if ! METAL_CHECK_OUTPUT=$(xcrun -sdk macosx metal -v 2>&1 >/dev/null); then
    echo "[!] 缺依赖：Xcode Metal Toolchain"
    if [ -n "$METAL_CHECK_OUTPUT" ]; then
        printf '    %s\n' "$METAL_CHECK_OUTPUT"
    fi
    echo "    请运行：xcodebuild -downloadComponent MetalToolchain"
    exit 1
fi

echo "[+] 依赖 OK（zig $ZIG_VER, git, xcodebuild, xcrun metal, lipo, ar, ranlib）"

# --------- 拉源码（幂等）---------
sync_repo() {
    local url=$1
    local dir=$2
    local ref=$3
    if [ ! -d "$dir/.git" ]; then
        echo "[+] clone $url → $dir"
        git clone --branch "$ref" "$url" "$dir"
    else
        echo "[+] fetch $dir @ $ref"
        (cd "$dir" && git fetch --force --no-tags origin "refs/tags/$ref:refs/tags/$ref" 2>&1 | tail -3)
    fi
    (cd "$dir" && git reset --hard "$ref" && git clean -fd) >/dev/null
}

sync_repo https://github.com/ghostty-org/ghostty.git "$GHOSTTY_SRC" "$GHOSTTY_TAG"
sync_repo https://github.com/Lakr233/libghostty-spm.git "$LAKR_SRC" "$LAKR_TAG"

# --------- apply Lakr233 patches ---------
echo "[+] apply Lakr233 patches"
(cd "$LAKR_SRC" && bash Script/apply-patches.sh "$GHOSTTY_SRC") 2>&1 | tail -20

# --------- apply pier patches ---------
if [ -d "$PIER_PATCHES" ]; then
    for patch in "$PIER_PATCHES"/*.patch; do
        [ -f "$patch" ] || continue
        name=$(basename "$patch")
        if (cd "$GHOSTTY_SRC" && git apply --check --reverse "$patch") 2>/dev/null; then
            echo "[+] pier patch 已应用：$name"
            continue
        fi
        echo "[+] apply pier patch：$name"
        (cd "$GHOSTTY_SRC" && git apply "$patch")
    done
fi

# --------- 逐 arch build + ar 合并（绕开 libtool alignment bug）---------
BUILD_TMP="${PIER_ROOT}/.libghostty-build-tmp"
rm -rf "$BUILD_TMP" && mkdir -p "$BUILD_TMP"

build_arch() {
    local zig_target=$1  # aarch64-macos | x86_64-macos
    local arch_name=$2   # arm64 | x86_64
    echo "=============================================="
    echo "[+] 构建 $arch_name ($zig_target)"
    echo "=============================================="
    (
        cd "$GHOSTTY_SRC"
        rm -rf zig-out .zig-cache
        "$ZIG" build \
            -Doptimize=ReleaseFast \
            -Dtarget="$zig_target" \
            -Demit-xcframework=false \
            -Demit-macos-app=false \
            -Dapp-runtime=none \
            -Dinspector=false \
            -Dsentry=false \
            -Dcustom-shaders=false 2>&1 | tail -10
    )

    # 从每个独立 lib*.a（zig-cache 里的 zig build 中间产物）提取全部 .o，
    # 而不是从 libghostty-fat.a——后者是 zig 用 libtool 打的，Xcode 26.6
    # 的 libtool 静默丢 8 字节未对齐 .o（ftdebug/zutil/compiler_rt 等 84 个），
    # 我们要绕开这个 bug 保证符号完整。
    local extract_dir="$BUILD_TMP/extract-$arch_name"
    mkdir -p "$extract_dir"
    local lib_count=0
    for lib in "$GHOSTTY_SRC"/.zig-cache/o/*/lib*.a; do
        [ -f "$lib" ] || continue
        [ "$(basename "$lib")" = "libghostty-fat.a" ] && continue
        local lib_name
        lib_name=$(basename "$lib" .a)
        local sub="$extract_dir/$lib_name"
        mkdir -p "$sub"
        (
            cd "$sub"
            ar x "$lib"
            chmod -R u+rw .
        )
        lib_count=$(( lib_count + 1 ))
    done
    echo "[+] $arch_name 从 $lib_count 个独立 lib.a 里提取 .o"

    local merged="$BUILD_TMP/libghostty-$arch_name.a"
    # 用 find 显式列出全部 .o，避免 shell glob 打不开跨子目录
    find "$extract_dir" -maxdepth 2 -name '*.o' -print0 |
        xargs -0 ar rcs "$merged"
    ranlib "$merged"
    local member_count
    member_count=$(ar t "$merged" | grep -cv '^__' || true)
    echo "[+] $arch_name 归档：$merged ($(( $(stat -f "%z" "$merged") / 1024 / 1024 ))MB, $member_count members)"


    # 首次拷 headers（两 arch 的 header 一致，任选其一）
    if [ ! -d "$HEADERS_STAGING" ]; then
        mkdir -p "$HEADERS_STAGING"
        cp "$GHOSTTY_SRC/include/ghostty.h" "$HEADERS_STAGING/ghostty.h"
        cat > "$HEADERS_STAGING/module.modulemap" <<'EOF'
module libghostty {
    umbrella header "ghostty.h"
    export *
}
EOF
    fi
}

build_arch aarch64-macos arm64
build_arch x86_64-macos x86_64

# --------- lipo 合并成 universal ---------
UNIVERSAL_A="$BUILD_TMP/libghostty-universal.a"
echo "[+] lipo -create → universal fat archive"
lipo -create \
    "$BUILD_TMP/libghostty-arm64.a" \
    "$BUILD_TMP/libghostty-x86_64.a" \
    -output "$UNIVERSAL_A"
lipo -info "$UNIVERSAL_A"

# --------- xcframework 打包 ---------
echo "[+] xcodebuild -create-xcframework → $OUTPUT_XCF"
rm -rf "$OUTPUT_XCF"
xcodebuild -create-xcframework \
    -library "$UNIVERSAL_A" \
    -headers "$HEADERS_STAGING" \
    -output "$OUTPUT_XCF" 2>&1 | tail -3

# --------- 清理临时目录 ---------
rm -rf "$BUILD_TMP"

# --------- 简报 ---------
echo
echo "=============================================="
echo "[+] 构建完成"
echo "=============================================="
echo "  xcframework : $OUTPUT_XCF"
if [ -d "$OUTPUT_XCF" ]; then
    for slice in "$OUTPUT_XCF"/macos-*; do
        [ -d "$slice" ] || continue
        lib=$(find "$slice" -name '*.a' | head -1)
        sz=$(stat -f "%z" "$lib" 2>/dev/null || echo 0)
        mb=$(( sz / 1024 / 1024 ))
        echo "  slice       : $(basename "$slice") (${mb}MB)"
        lipo -info "$lib" 2>/dev/null || true
    done
fi
