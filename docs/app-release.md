# 宿主发布细节

总览与流程图：[`release.md`](./release.md)。本文只补宿主 CI / secrets / 本地命令。

## CI

- Workflow：`.github/workflows/release-app.yml`
- 触发：`push` tags `v*`；或 `workflow_dispatch`（输入已有 tag）
- `workflow_dispatch` 会 **checkout 该 tag**，不用默认分支 HEAD
- 关键步骤：`verify-app-release-version.mjs`（tag 去 `v` == `package.json` version）→ `pnpm build:dist --publish=always`
- `build:dist`：**先** `electron-builder --publish never` 打齐双架构 → `verify-mac-release-artifacts.mjs` 硬校验 → 通过后才 `publish-mac-release-artifacts.mjs` 上传
- 必需资产（electron-builder 默认命名，x64 无 arch 后缀）：
  - `latest-mac.yml`
  - `Pier-<ver>-arm64-mac.zip` / `Pier-<ver>-mac.zip`
  - `Pier-<ver>-arm64.dmg` / `Pier-<ver>.dmg`
- `publish-mac-release-artifacts.mjs` 会强制 `EP_GH_IGNORE_TIME=true`（覆盖 >2h 旧 release 的静默 skip），并在上传后再查 GitHub 远端资产；缺 arm64 dmg 等会硬失败
- `electron-builder.yml`：`publish.releaseType: release`（禁止 draft，否则无 Latest）
- 使用 `CSC_LINK` 时 workflow 设置 `PIER_DIST_ALLOW_CSC_LINK_PUBLISH=1`（`build-dist.sh` 默认禁 CSC_LINK publish）
- 发布后门禁：
  - 本地：`verify-mac-release-artifacts.mjs --dir dist-builder --version <ver>`
  - 上传后远端：publish wrapper 内嵌 dual-arch 校验
  - GitHub Latest：`verify-github-latest-isolation.mjs --expect-version <ver>`

## Secrets

与 `electron-builder.env.example` 对齐：

| Secret | 用途 |
|---|---|
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Developer ID p12（CI 常用） |
| `CSC_NAME` | CSC_LINK 时必填 |
| `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` | 公证（API key，CI 推荐） |
| 或 `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` | 公证 |
| 或 `APPLE_KEYCHAIN_PROFILE` + `APPLE_TEAM_ID` | 本机 keychain profile |
| `GITHUB_TOKEN` | workflow 自带，用于 publish |

## 本地

```bash
export GH_TOKEN="$(gh auth token)"
# keychain Developer ID + notarize profile 已就绪时：
pnpm build:dist --publish=always

# 仅 CSC_LINK p12：
# PIER_DIST_ALLOW_CSC_LINK_PUBLISH=1 pnpm build:dist --publish=always
```

只出包不发布：`pnpm build:dist`（默认 `--publish=never`）。  
只签名不公证：`pnpm build:dist --no-notarize`。

## 客户端（production）

- 启动约 30s 首次检查，默认每 24h；回前台且间隔已满会补检
- 发现更新后后台下载；「重启安装」与普通退出一样先 flush 布局，再 `quitAndInstall`；或退出时 `autoInstallOnAppQuit`
- dev / `pnpm dev` 为 `disabled`，不打更新网
