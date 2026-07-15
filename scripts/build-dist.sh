#!/usr/bin/env bash
#
# 分发打包入口。
#
# 1. 加载 electron-builder.env（如存在）—— 签名 / notarize / publish 凭证
# 2. 构建 universal (arm64 + x86_64) native artifacts
# 3. 构建 renderer / main / preload
# 4. 打两个 dmg + zip 更新包（arm64 + x64）
#
# 前置：
#   - macOS + xcode-select --install
#   - GhosttyKit.xcframework 已在 native/Vendor/... (缺则 pnpm build:libghostty)
#   - 签名证书在 keychain（Developer ID Application）
#   - notarize 凭证：APPLE_KEYCHAIN_PROFILE (推荐) 或 APPLE_ID+APPLE_APP_SPECIFIC_PASSWORD+APPLE_TEAM_ID
#     不 notarize 的话可先跑 --no-notarize
#
# 用法：
#   pnpm build:dist                    # 完整签名 + notarize，本地出包不发布
#   pnpm build:dist --no-notarize      # 只签名不 notarize（本机测/内部装）
#   pnpm build:dist --publish=always   # 发布到 electron-builder.yml 配置的 provider
#   PIER_DIST_PUBLISH=always pnpm build:dist

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PIER_ROOT"

# ---------- 参数 ----------
EB_EXTRA_ARGS=()
PUBLISH_POLICY="${PIER_DIST_PUBLISH:-never}"
while [ "$#" -gt 0 ]; do
    arg="$1"
    case "$arg" in
        --no-notarize)
            EB_EXTRA_ARGS+=(-c.mac.notarize=false)
            shift
            ;;
        --publish=*)
            PUBLISH_POLICY="${arg#--publish=}"
            shift
            ;;
        --publish)
            if [ "$#" -lt 2 ]; then
                echo "[build:dist] --publish 需要参数: never | onTag | onTagOrDraft | always"
                exit 2
            fi
            PUBLISH_POLICY="$2"
            shift 2
            ;;
        *)
            EB_EXTRA_ARGS+=("$arg")
            shift
            ;;
    esac
done

# ---------- 加载 electron-builder.env ----------
# set -a 让 source 出来的赋值自动 export 到子进程；set +a 恢复。
# electron-builder 靠这些 env 变量拿 signing / notarize 凭证。
ENV_FILE="electron-builder.env"
if [ -f "$ENV_FILE" ]; then
    echo "[build:dist] loading $ENV_FILE"
    set -a
    # shellcheck source=/dev/null
    . "$ENV_FILE"
    set +a
else
    echo "[build:dist] 未找到 $ENV_FILE, 将只用环境变量"
fi

# ---------- 构建 ----------
echo "[build:dist] [1/3] universal native (arm64 + x86_64)"
NATIVE_ARCHS="arm64 x86_64" pnpm build:native

echo "[build:dist] [2/4] package bundled plugins"
pnpm plugins:pack

echo "[build:dist] [3/4] electron-vite build (main / preload / renderer)"
pnpm build:electron

# macOS 系统 bash 3.2 对空数组 "${arr[@]}" 在 set -u 下会报 unbound，
# 用 ${arr[@]+"${arr[@]}"} 惯用法兜住。
echo "[build:dist] [4/4] electron-builder --mac --arm64 --x64 --publish $PUBLISH_POLICY"
pnpm exec electron-builder --mac --arm64 --x64 --publish "$PUBLISH_POLICY" ${EB_EXTRA_ARGS[@]+"${EB_EXTRA_ARGS[@]}"}

echo "[build:dist] done → dist-builder/"
ls -lh dist-builder/*.dmg dist-builder/*.zip dist-builder/latest*.yml 2>/dev/null || true
