# 宿主发布细节

文档索引：[`README.md`](./README.md)。总览与流程图：[`release.md`](./release.md)。本文只补宿主 CI / secrets / 本地命令。

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
- 官网博客：Latest 校验通过后，同一 workflow 调用 `Publish Release to Blog`。从该 tag 的 `CHANGELOG.md` 生成中英日韩文章，直接推到 `runloom/pier-website` 的 `main`，Pages 自动部署。无对应 CHANGELOG 条目或文章已存在则跳过。补发用 Actions 手动 `workflow_dispatch`，填 `vX.Y.Z`。正式版本的 CHANGELOG 条目会原样变成官网文章，面向用户写。

  **不要**指望 `on: release`。本 workflow 用 `GITHUB_TOKEN` 创建 GitHub Release，GitHub 不会再用这个 token 去触发其它 workflow。

## Secrets

签名 / 公证 / 上传与 `electron-builder.env.example` 对齐：

| Secret | 用途 |
|---|---|
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Developer ID p12（CI 常用） |
| `CSC_NAME` | CSC_LINK 时必填 |
| `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` | 公证（API key，CI 推荐） |
| 或 `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` | 公证 |
| 或 `APPLE_KEYCHAIN_PROFILE` + `APPLE_TEAM_ID` | 本机 keychain profile |
| `GITHUB_TOKEN` | workflow 自带，用于 publish |

官网博客（CI 仓库 Secrets，不进 `electron-builder.env`）：

| Secret | 用途 |
|---|---|
| `BLOG_PAT` | 写 `runloom/pier-website`（`contents:write`）；直推 `main` |
| `LLM_API_KEY` / `LLM_MODEL` | en/ja/ko 翻译（缺则只发中文）；`LLM_BASE_URL` 可选 |

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
