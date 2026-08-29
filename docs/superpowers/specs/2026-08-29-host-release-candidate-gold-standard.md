# 宿主发布候选版金标准

日期：2026-08-29  
状态：现行权威（宿主 mac 发布：候选预发布 → 观察期 → 晋升正式；显式直接发布可跳过候选）  
范围：`Release App`、`build:dist` / `publish-mac-release-artifacts`、GitHub Latest 隔离、`publish-project` skill、客户端「接收候选版本」opt-in（设置 → 更新）。  
不包含：插件通道（本就 prerelease）、灰度放量（`stagingPercentage`）、独立 beta 更新通道文件（`beta-mac.yml`）。

## 一句话终态

常规宿主发版先以 **semver 候选版**（`X.Y.Z-rc.N`）发 GitHub **prerelease**（不占 Latest、不发博客）；观察期后晋升为无后缀正式版；显式触发「直接发布」可跳过候选直达正式版（验证不减）。

## 版本语义

| 形态 | `package.json` version | GitHub tag | Release 属性 |
|------|------------------------|------------|--------------|
| 候选版 | `X.Y.Z-rc.N` | `vX.Y.Z-rc.N` | prerelease；`--latest=false` |
| 正式版 | `X.Y.Z` | `vX.Y.Z` | release；占 Latest |
| 直接发布 | `X.Y.Z`（跳过 rc） | `vX.Y.Z` | 同正式版 |

- version 与 tag 同构（去 `v` 后严格相等）；`verify-app-release-version.mjs` 零特例。
- 每轮候选必须 bump PR 进 main（中间产物落 main）；禁止改已有 tag。
- 同 version 不改已发布内容；修缺陷 → 递增 rc 或新正式版号。

## 三条路径

1. **候选版（默认）**：合 main → 发插件 → bump `X.Y.Z-rc.N` → tag → Release App 候选模式 → 观察期。
2. **晋升正式版**：最新候选构建绿；main 在候选 tag 后无 `src/` `packages/` `native/` 实质变更 → bump 去 rc 后缀 + CHANGELOG 定稿 → tag `vX.Y.Z` → 现有 Latest 路径（含博客）。
3. **直接发布**：仅显式触发；跳过候选与观察期；preflight / CI 不减；收尾报告标注直接发布。命名描述机制（跳过候选直达正式版），场景由触发方判断（如早期无用户基础、线上严重缺陷需立即修复）。

## 隔离规则

1. Latest tag 必须是稳定宿主 semver：`^v\d+\.\d+\.\d+$`（禁止 `-rc.`、禁止 `plugin-`）。
2. 候选 release 必须 prerelease、非 draft，且不得成为 Latest。
3. 插件 release 规则不变（prerelease、不占 Latest）。
4. 候选模式跑 Latest 隔离时不传 `--expect-version`（Latest 仍为上一正式版）；另校验本候选 tag 的隔离。
5. Release App resolve 阶段 tag 形状白名单：仅接受 `vX.Y.Z` / `vX.Y.Z-rc.N`；其它预发布形状（beta/alpha 等）立即失败——否则会落入 stable 路径，在隔离校验跑到之前抢占 Latest。

## Workflow 行为差异

| | 候选 (`channel=candidate`) | 正式 (`channel=stable`) |
|--|---------------------------|-------------------------|
| 触发 tag | `v*-rc.*` | `v*` 无 rc |
| `build:dist` | `--publish=always --prerelease` | `--publish=always` |
| 发布后兜底 | `gh release edit $TAG --prerelease --latest=false` | 无（正式 release） |
| Latest 校验 | isolation 无 `--expect-version` + `--candidate-tag` | `--expect-version` |
| 官网博客 | 跳过 | `Publish Release to Blog` |

## 客户端候选更新（opt-in）

- 偏好 `receiveCandidateUpdates`（默认 **false**）：设置 → 更新「接收候选版本」；正式用户不受候选影响。
- **禁止裸用 electron-updater `allowPrerelease`**：本仓库 Releases 混有插件 prerelease，`allowPrerelease` 未设 channel 会取 feed 首条（可能是插件 tag → 无 latest-mac.yml 硬错）；设 `channel="rc"` 会跳过更新的稳定版。
- **适配器构造后强制 `allowPrerelease = false`**：electron-updater 对 rc 运行版本会在构造期自动开启（`hasPrereleaseComponents(currentVersion)`），不关掉则装上候选后升不到晋升稳定版、关闭开关也退不回 Latest。
- 单一实现 `src/main/services/app-updates/candidate-feed.ts`：只认宿主 tag（`vX.Y.Z(-rc.N)?`），semver 全序取最大——最大是稳定版或候选不比当前新 → 默认 Latest；最大是更新的候选 → `setFeedURL` generic 指向该 tag 的 `releases/download/<tag>/`。
- 解析请求：`per_page=100`，首页被插件 release 挤满且无宿主 tag 时补拉第二页；10s 超时。截断/失败（离线/限流/超时）降级 Latest，不让稳定通道检查失败。
- 关闭开关：下次检查回 Latest；已下载的候选包不回退。

## 禁止

1. 默认路径直打无 rc 后缀的正式 `v*` tag（正式 tag 只出自晋升或显式触发的直接发布）。
2. 候选 prerelease 占 Latest，或把 `-rc.` tag 发成非 prerelease。
3. 未显式触发而走直接发布：默认触发恒为候选路径；「直接发布」永远是触发方的显式选择。
4. 在已有候选 / 正式 tag 上改资产语义而不 bump。

## 检查点

- Workflow：`tests/unit/main/app-core/release-workflow.test.ts`
- 隔离：`tests/unit/main/preferences/github-latest-isolation.test.ts`、`mac-release-assets.test.ts`
- 客户端候选更新：`tests/unit/main/app-updates/candidate-feed.test.ts`、`tests/unit/renderer/app/update-section.test.tsx`、`tests/unit/app/preferences-schema.test.ts`
- 文档：本文件；[`docs/release.md`](../../release.md)；[`docs/app-release.md`](../../app-release.md)；AGENTS.md「宿主发布候选版 — 金标准」；`.agents/skills/publish-project/SKILL.md`
