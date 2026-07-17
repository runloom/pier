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
#   pnpm build:dist --allow-dev-sign   # 允许用 Apple Development 签名（不可分发）
#   pnpm build:dist --publish=always   # 发布到 electron-builder.yml 配置的 provider
#   PIER_DIST_PUBLISH=always pnpm build:dist

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PIER_ROOT"

# ---------- 参数 ----------
EB_EXTRA_ARGS=()
PUBLISH_POLICY="${PIER_DIST_PUBLISH:-never}"
ALLOW_DEV_SIGN=0
NO_NOTARIZE=0
while [ "$#" -gt 0 ]; do
    arg="$1"
    case "$arg" in
        --no-notarize)
            NO_NOTARIZE=1
            EB_EXTRA_ARGS+=(-c.mac.notarize=false)
            shift
            ;;
        --allow-dev-sign)
            # 本机调试逃生舱：允许 Apple Development / 无 Developer ID。
            # 产物不可对外分发，也不应 notarize。
            ALLOW_DEV_SIGN=1
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

# ---------- macOS code signing / notarize preflight ----------
# 分发包必须用 Developer ID Application。electron-builder 在找不到
# Developer ID 时会回退到 Apple Development，产物能装本机但 Gatekeeper
# 对外会拦，且无法 notarize。默认在这里硬失败，避免“假签名”出包。
if [ "$(uname -s)" = "Darwin" ]; then
    IDENTITY_LIST="$(security find-identity -v -p codesigning 2>/dev/null || true)"
    DEVELOPER_ID_LINE="$(printf '%s\n' "$IDENTITY_LIST" | grep 'Developer ID Application:' || true)"

    if [ -n "$DEVELOPER_ID_LINE" ]; then
        # 例: 1) ABCD... "Developer ID Application: Foo (TEAMID)"
        DEVELOPER_ID_NAME="$(printf '%s\n' "$DEVELOPER_ID_LINE" | sed -n 's/.*"\(Developer ID Application: .*\)".*/\1/p' | head -n 1)"
        DEVELOPER_ID_TEAM="$(printf '%s\n' "$DEVELOPER_ID_NAME" | sed -n 's/.*(\([A-Z0-9]\{10\}\))$/\1/p')"
        echo "[build:dist] signing identity: $DEVELOPER_ID_NAME"

        # 未显式指定时钉死 Developer ID，避免误选 Development 证书。
        if [ -z "${CSC_NAME:-}" ]; then
            export CSC_NAME="$DEVELOPER_ID_NAME"
            echo "[build:dist] CSC_NAME=$CSC_NAME"
        else
            echo "[build:dist] CSC_NAME(from env)=$CSC_NAME"
        fi
        if [ -z "${APPLE_TEAM_ID:-}" ] && [ -n "$DEVELOPER_ID_TEAM" ]; then
            export APPLE_TEAM_ID="$DEVELOPER_ID_TEAM"
            echo "[build:dist] APPLE_TEAM_ID=$APPLE_TEAM_ID"
        fi
    elif [ "$ALLOW_DEV_SIGN" -eq 1 ]; then
        echo "[build:dist] WARNING: 未找到 Developer ID Application，已启用 --allow-dev-sign"
        echo "[build:dist] 将使用 Apple Development / 可用身份，产物不可对外分发"
        if [ "$NO_NOTARIZE" -eq 0 ]; then
            echo "[build:dist] dev-sign 模式强制关闭 notarize"
            NO_NOTARIZE=1
            EB_EXTRA_ARGS+=(-c.mac.notarize=false)
        fi
    else
        echo "[build:dist] ERROR: 未找到可用的 Developer ID Application 签名身份" >&2
        echo "[build:dist] 当前 codesigning identities:" >&2
        printf '%s\n' "$IDENTITY_LIST" >&2
        echo >&2
        echo "如何安装正式签名证书：" >&2
        echo "  1) Apple Developer → Certificates → Developer ID Application（或从已有机器导出 .p12）" >&2
        echo "  2) 双击导入 login keychain，确认私钥存在（Keychain Access 显示证书有下拉 key）" >&2
        echo "  3) 验证: security find-identity -v -p codesigning | grep 'Developer ID Application'" >&2
        echo "  4) 写入 electron-builder.env（见 electron-builder.env.example）后重跑 pnpm build:dist" >&2
        echo >&2
        echo "仅本机调试可: pnpm build:dist --allow-dev-sign --no-notarize" >&2
        exit 1
    fi

    # notarize 凭证预检（可被 --no-notarize 跳过）
    if [ "$NO_NOTARIZE" -eq 0 ]; then
        has_notary=0
        if [ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]; then
            if xcrun notarytool history --keychain-profile "$APPLE_KEYCHAIN_PROFILE" >/dev/null 2>&1; then
                has_notary=1
                echo "[build:dist] notarize profile ok: $APPLE_KEYCHAIN_PROFILE"
            else
                echo "[build:dist] ERROR: APPLE_KEYCHAIN_PROFILE=$APPLE_KEYCHAIN_PROFILE 不可用" >&2
                echo "[build:dist] 重建: xcrun notarytool store-credentials $APPLE_KEYCHAIN_PROFILE --apple-id <id> --team-id <TEAM>" >&2
                exit 1
            fi
        elif [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_KEY_ID:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ]; then
            has_notary=1
            echo "[build:dist] notarize via App Store Connect API key"
        elif [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
            has_notary=1
            echo "[build:dist] notarize via Apple ID + app-specific password"
        fi
        if [ "$has_notary" -eq 0 ]; then
            echo "[build:dist] ERROR: 已启用 notarize，但未配置凭证" >&2
            echo "[build:dist] 任选其一写入 electron-builder.env：" >&2
            echo "  - APPLE_KEYCHAIN_PROFILE=pier-notarize   # 推荐" >&2
            echo "  - APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER" >&2
            echo "  - APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID" >&2
            echo "或临时跳过: pnpm build:dist --no-notarize" >&2
            exit 1
        fi
    else
        echo "[build:dist] notarize disabled (--no-notarize)"
    fi
fi

# ---------- dmgbuild toolset preflight (macOS) ----------
# electron-builder 26 的 dmg-builder 会下载自带 Python 的 dmgbuild bundle
# （当前 pin：dmg-builder@1.2.5 / dmgbuild-bundle-*-75c8a6c）。
# 解压目录损坏或被 macOS 库校验拒绝时，报错形如：
#   ImportError: ... _struct.cpython-314-darwin.so ... library load denied by system policy
# 这不是 app 签名问题。预检失败就清缓存，让 electron-builder 重新下载解压。
if [ "$(uname -s)" = "Darwin" ]; then
    EB_CACHE="${ELECTRON_BUILDER_CACHE:-$HOME/Library/Caches/electron-builder}"
    # 与 node_modules/.../dmg-builder/out/dmgUtil.js 的 releaseName 对齐；
    # 未命中目录则跳过（首次构建会下载）。
    for dmg_cache in "$EB_CACHE"/dmg-builder@1.2.*; do
        [ -d "$dmg_cache" ] || continue
        dmgbuild_bin="$(find "$dmg_cache" -maxdepth 2 -type f -name dmgbuild 2>/dev/null | head -n 1 || true)"
        if [ -z "$dmgbuild_bin" ]; then
            continue
        fi
        py_bin="$(cd "$(dirname "$dmgbuild_bin")" && pwd)/python/bin/python3"
        # bash 3.2 无 watchdog 做超时；坏缓存上 --help 可能卡住。
        dmgbuild_ok=0
        if [ -x "$py_bin" ]; then
            (
                "$py_bin" -c "import dmgbuild" >/dev/null 2>&1
            ) &
            py_pid=$!
            (
                sleep 8
                kill "$py_pid" >/dev/null 2>&1 || true
            ) &
            watch_pid=$!
            if wait "$py_pid" 2>/dev/null; then
                dmgbuild_ok=1
            fi
            kill "$watch_pid" >/dev/null 2>&1 || true
            wait "$watch_pid" 2>/dev/null || true
        fi
        if [ "$dmgbuild_ok" -ne 1 ]; then
            echo "[build:dist] dmgbuild toolset 不可用（macOS library validation / 损坏缓存）"
            echo "[build:dist] 清理 $dmg_cache 后由 electron-builder 重新下载"
            rm -rf "$dmg_cache"
        else
            echo "[build:dist] dmgbuild toolset ok: $dmgbuild_bin"
        fi
    done
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
