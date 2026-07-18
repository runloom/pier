# Pier 宿主应用发布

生产自动更新依赖公开 GitHub Release 的 **Latest** 资产（`latest-mac.yml` + mac zip）。插件 release 必须保持 prerelease，不得占用 Latest。

## 常规发布

1. 将 `package.json` 的 `version`  bump 到目标版本（与即将打的 tag 一致，不要带 `v`）。
2. 合并到默认分支后打 tag：

```bash
git tag v0.2.0
git push origin v0.2.0
```

3. GitHub Actions 工作流 `Release App`（`.github/workflows/release-app.yml`）会：
   - 校验 tag 版本 == `package.json` version
   - 运行 `pnpm build:dist --publish=always`
   - 上传 dmg / zip / `latest-mac.yml` 到 GitHub Release，并作为 Latest

4. 验收：

```text
https://github.com/runloom/pier/releases/latest
```

页面中应能看到 `latest-mac.yml` 与对应 arch 的 mac zip。

## 手动补发

Actions → **Release App** → `workflow_dispatch`，输入 tag（如 `v0.2.0`）。  
tag 必须已存在且版本与 `package.json` 一致。

## Secrets

CI 需要（按本机 `electron-builder.env.example` 对齐）：

| Secret | 用途 |
|---|---|
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Developer ID 签名 p12（CI 常用） |
| `CSC_NAME` | 使用 CSC_LINK 时必填（Developer ID 显示名） |
| `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` | 公证（API key 方式，CI 推荐） |
| 或 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | 公证（Apple ID 方式） |
| 或 `APPLE_KEYCHAIN_PROFILE` / `APPLE_TEAM_ID` | 公证（本机 keychain profile） |
| `GITHUB_TOKEN` | workflow 默认提供，用于 publish |

`release-app.yml` 在使用 `CSC_LINK` 发布时会设置 `PIER_DIST_ALLOW_CSC_LINK_PUBLISH=1`（`build-dist.sh` 默认禁止 CSC_LINK publish，防止误用 Development p12）。

## 本地兜底

签名与公证本机已就绪时：

```bash
# keychain Developer ID + notary profile
export GH_TOKEN="$(gh auth token)"
pnpm build:dist --publish=always

# 若只用 CSC_LINK p12 发布：
# PIER_DIST_ALLOW_CSC_LINK_PUBLISH=1 pnpm build:dist --publish=always
```

需要 `GH_TOKEN`（或写入 `electron-builder.env`）且版本已对齐。
`workflow_dispatch` 会 checkout 指定 tag，避免默认分支 HEAD 与 tag 版本漂移。

## 与插件发布的隔离

- 宿主：本工作流 → repo **Latest**（electron-updater 读取 `/releases/latest`）。
- 插件：`release-plugin.yml` 使用 `--latest=false --prerelease`，tag 形如 `plugin-codex-v1.2.3`，不得成为 Latest。

## 客户端行为摘要

- 仅 production 打包启用检查。
- 启动约 30s 后检查，之后每 24h；窗口重新聚焦且间隔已满时补检。
- 发现更新后后台下载；用户经右上角入口或 Settings → Updates 选择「重启安装」。
- 不会在未确认时自动 `quitAndInstall`（退出时可由 electron-updater `autoInstallOnAppQuit` 应用已下载更新）。
