---
name: publish-project
description: >
  发布 Pier：先合入 main（PR + CI 修到绿 + 合并），再先插件后宿主发版，中间产物回合
  main，全程修 CI。触发：/publish-project、发布项目、发版、release Pier。默认全自动，
  不中途询问版本号 / 合并 / 打 tag。
---

# 发布 Pier

两阶段：**合入 main → 发版**。文档细节见 `docs/release.md` / `docs/app-release.md`。

## 规则

- **默认全自动跑完**：合并 PR、选插件、patch bump、推 tag 均自行决策并执行，中途不向用户确认。仅在**无法继续的硬阻塞**时停下报告（脏工作区且有不明改动、缺 secrets、权限不足、需人工裁决的策略冲突）。
- 默认走 GitHub Actions，不本地硬发。
- **正确性在本地**：默认 pre-push 已是 `preflight:push`（static+unit+component）。合 main / 发版 push 前再跑 `pnpm preflight:ci`（或 `PIER_PREFLIGHT=ci git push`）；mac 需要 native 时用 `preflight:full`。目标 **远程一次绿**。
- CI 红：先本地复现修绿再 push；禁止「改一处 → 盲等远程」。禁止 force-push `main`。
- 插件 tag：`plugin-<tail>-v<ver>`（prerelease）；宿主 tag：`vX.Y.Z`（Latest）。
- 插件 `package.json` 与 `plugin.json` 的 version 必须一致；有实质变更必须 bump。
- 默认 **patch** bump；用户在触发时若写明 minor/major 或指定版本则从其约定。
- 中间改动（version / CHANGELOG / 索引）必须落在 `main`，不能只在旁支。
- 收尾再一次性向用户汇报：PR、插件 tag、宿主 `v*`、失败需人工项。

---

## 阶段 A：合入 main

```bash
git fetch origin
git merge-base --is-ancestor HEAD origin/main && echo MERGED || echo NOT_MERGED
```

| 结果 | 动作 |
|---|---|
| 已合入 | `git checkout main && git pull --ff-only` → 阶段 B |
| 未合入 | **本地** `pnpm preflight:ci` 绿 → push → 开/复用 PR → CI 确认一次绿 → 合并 → pull main |

```bash
pnpm preflight:ci && git push
# 或 PIER_PREFLIGHT=ci git push
```

CI 若仍红：日志定位失败文件 → 本地修到 `preflight:ci` 绿 → **一次** push。  
冲突先 rebase/merge `origin/main`。可合并后 `gh pr merge`（优先 squash 若仓库允许）。脏工作区：明确修复可 stage；不明改动停并报告。

---

## 阶段 B：发版

始终在最新 `main` 上操作。顺序：**插件 → 宿主**。

### B1 看哪些插件要发

可发：`packages/plugin-{claude,codex,grok,ssh}`（有 `plugin.json`；`plugin-api` 不发）。

对每个 tail，若相对最近 `plugin-<tail>-v*` tag 有源码变更、或 version 已 bump 但 release 不存在 → 列入待发并 **patch bump** 两端 version；否则跳过。

无需列出等人确认；在最终报告里写清跳过/待发与版本。

### B2 发插件

1. PR 合入 version bump → 触发 `Release Plugin`
2. `gh run watch` 等到绿；红则修再合 main（或 `workflow_dispatch` 恢复，要求 main 上 version 已对）
3. `git pull` 吃 bot 的 `plugins/index.v1.json`
4. 确认 tag 为 prerelease，且不占 Latest

多插件可同一 PR；合完再进宿主。

### B3 发宿主

1. 若 `package.json` version 已等于最新 `v*` tag 且 main 有新提交 → patch bump；已高于 tag 则沿用当前 version
2. PR：根 `package.json` version + `CHANGELOG`（Unreleased → 正式条目）→ CI 绿 → 合 main
3. 在 main 上：`git tag v$VERSION && git push origin v$VERSION`（触发 `Release App`）
4. 等到绿；验收 Latest 含 `latest-mac.yml` + arm64/x64 的 zip/dmg

### B4 收尾

- pull 最新 main，确认 bump / CHANGELOG / 索引都在
- 向用户报告：PR、插件 tag、宿主 `v*`、失败需人工项

---

## CI 怎么修

1. `gh run view <id> --log-failed` / `rg "FAIL  tests/"` 收集失败文件  
2. 本地：`pnpm preflight:ci` 或针对性 `pnpm exec vitest run <file>`  
3. 绿后一次 push；同一 flaky job 最多重跑一次，再红当实错修  

本地档位见 `pnpm preflight --help` / `docs/development.md`（push / merge / ci / full）。  
发布失败对照 `docs/app-release.md`（宿主）/ `docs/release.md`（插件）。

---

## 不要

- 功能未进 main 就打 `v*`
- 先宿主、后「本车该发」的插件（用户只要宿主除外）
- 同 version 改已发布包内容
- 修只在 tag/旁支、不回 main
- 中途停下来问「要不要合并 / 发哪些插件 / 版本多少」（用户触发 `/publish-project` 即授权全自动）
