---
name: publish-project
description: >
  发布 Pier：先合入 main（PR + CI 修到绿 + 合并），再先插件后宿主发版，中间产物回合
  main，全程修 CI。触发：/publish-project、发布项目、发版、release Pier。
---

# 发布 Pier

两阶段：**合入 main → 发版**。文档细节见 `docs/release.md` / `docs/app-release.md`。

## 规则

- 默认走 GitHub Actions，不本地硬发。
- CI 红必须修绿再往下；禁止 force-push `main`。
- 插件 tag：`plugin-<tail>-v<ver>`（prerelease）；宿主 tag：`vX.Y.Z`（Latest）。
- 插件 `package.json` 与 `plugin.json` 的 version 必须一致；有实质变更必须 bump。
- 版本号、发哪些插件、合并 PR、推 tag：动手前跟用户确认一次（用户说全自动除外）。
- 中间改动（version / CHANGELOG / 索引）必须落在 `main`，不能只在旁支。

---

## 阶段 A：合入 main

```bash
git fetch origin
git merge-base --is-ancestor HEAD origin/main && echo MERGED || echo NOT_MERGED
```

| 结果 | 动作 |
|---|---|
| 已合入 | `git checkout main && git pull --ff-only` → 阶段 B |
| 未合入 | 推分支 → 开/复用 PR 到 main → 盯 CI → 修 → 绿 → 合并 → pull main |

**CI 循环：** `gh pr checks` / 失败日志 → 最小修复 → push；冲突先 rebase/merge `origin/main`。  
可合并后再 `gh pr merge`。脏工作区先停，问用户怎么处理。

---

## 阶段 B：发版

始终在最新 `main` 上操作。顺序：**插件 → 宿主**。

### B1 看哪些插件要发

可发：`packages/plugin-{claude,codex,grok,ssh}`（有 `plugin.json`；`plugin-api` 不发）。

对每个 tail，若相对最近 `plugin-<tail>-v*` tag 有源码变更、或 version 已 bump 但 release 不存在 → 列入待发；否则跳过。

默认 patch bump；列表与版本跟用户确认后改两端 version。

### B2 发插件

1. PR 合入 version bump → 触发 `Release Plugin`
2. `gh run watch` 等到绿；红则修再合 main（或 `workflow_dispatch` 恢复，要求 main 上 version 已对）
3. `git pull` 吃 bot 的 `plugins/index.v1.json`
4. 确认 tag 为 prerelease，且不占 Latest

多插件可同一 PR；合完再进宿主。

### B3 发宿主

1. PR：根 `package.json` version + `CHANGELOG`（Unreleased → 正式条目）→ CI 绿 → 合 main
2. 在 main 上：`git tag v$VERSION && git push origin v$VERSION`（触发 `Release App`）
3. 等到绿；验收 Latest 含 `latest-mac.yml` + arm64/x64 的 zip/dmg

### B4 收尾

- pull 最新 main，确认 bump / CHANGELOG / 索引都在
- 向用户报告：PR、插件 tag、宿主 `v*`、失败需人工项

---

## CI 怎么修

读日志 → 本地复现（优先 `pnpm check:static`）→ 小步提交 → push。  
同一 flaky job 最多重跑一次；再红当实错修。  
发布失败对照 `docs/app-release.md`（宿主）/ `docs/release.md`（插件）。

---

## 不要

- 功能未进 main 就打 `v*`
- 先宿主、后「本车该发」的插件（用户只要宿主除外）
- 同 version 改已发布包内容
- 修只在 tag/旁支、不回 main
