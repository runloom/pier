---
name: publish-project
description: >
  发布 Pier：合入 main 后先插件后宿主。宿主默认发候选版（vX.Y.Z-rc.N prerelease），
  「晋升正式版」打稳定 tag；「直接发布」显式跳过候选直达正式版。触发：/publish-project、
  发版、晋升正式版、直接发布。默认全自动，不中途询问版本号 / 合并 / 打 tag。
---

# 发布 Pier

两阶段：**合入 main → 发版**。文档：`docs/release.md` / `docs/app-release.md`。  
金标准：`docs/superpowers/specs/2026-08-29-host-release-candidate-gold-standard.md`。

## 规则

- **默认全自动跑完当前路径**：合并 PR、选插件、版本 bump、推 tag 自行决策并执行；仅硬阻塞停下报告（脏工作区不明改动、缺 secrets、权限、策略冲突）。
- 默认走 GitHub Actions，不本地硬发。
- **正确性在本地**：默认 pre-push 已是 `preflight:push`。合 main / 发版 push 前再跑 `pnpm preflight:ci`（或 `PIER_PREFLIGHT=ci git push`）；mac native 用 `preflight:full`。目标 **远程一次绿**。
- CI 红：先本地复现修绿再 push；禁止「改一处 → 盲等远程」。禁止 force-push `main`。
- 插件 tag：`plugin-<tail>-v<ver>`（prerelease）；宿主候选：`vX.Y.Z-rc.N`（prerelease）；宿主正式：`vX.Y.Z`（Latest）。
- 插件 `package.json` 与 `plugin.json` 的 version 必须一致；有实质变更必须 bump。
- 宿主候选 version = `X.Y.Z-rc.N`（与 tag 同构）；每轮 rc 一次 bump PR。晋升去掉 `-rc.N`。默认 **patch** 基线；用户写明 minor/major 或指定版本则从其约定。
- 中间改动（version / CHANGELOG / 索引）必须落在 `main`，不能只在旁支。
- 收尾再一次性向用户汇报：PR、插件 tag、宿主 tag / channel、官网博客（正式才有）、失败需人工项。

## 发布路径

| 触发 | 路径 |
|---|---|
| `/publish-project`（默认）、「发版」、「发布」 | 合 main → 发插件 → 发候选版 `v$VER-rc.N`（prerelease）→ 报告，停 |
| 「晋升正式版」、「发布正式版」 | 校验候选绿 + main 无新实质变更 → bump 去 rc + CHANGELOG 定稿 → 打 `v$VER` → 验收 Latest + 博客 |
| 「直接发布」、「直发正式版」、「跳过候选发布」 | 显式触发才走：跳过候选，验证不减，直接打 `v$VER`；报告标注直接发布 |

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

### B3 宿主：按触发路径分流

#### B3a 候选版（默认）

1. 目标基线：若最新正式 `v*` 为 `X.Y.Z`，下一候选默认 `X.Y.(Z+1)-rc.1`（或用户指定基线）；若已有同基线更高 `rc.N`，递增 N。
2. PR：根 `package.json` version = `X.Y.Z-rc.N`（CHANGELOG 可留 Unreleased 或记候选说明）→ CI 绿 → 合 main
3. main 上：`git tag v$VERSION && git push origin v$VERSION`（触发 Release App **候选模式**）
4. 等到绿：构建同正式；GitHub **prerelease**；不占 Latest；不发博客
5. 报告：候选 tag、预发布下载页、「确认后说『晋升正式版』」；**到此为止，不自动晋升**

观察期缺陷：修复合入 main → 下一候选 bump（`rc.N+1`）重走 B3a；禁止改已有 tag。

#### B3b 晋升正式版

前置（任一不满足则停下报告）：

- 存在同基线最新候选 tag，且其 Release App 构建为绿
- main 在该候选 tag 之后无 `src/` / `packages/` / `native/` 实质变更  
  （仅文档 / CHANGELOG / 版本号 → 放行并在报告列明；有实质变更 → 停，建议重出候选）

执行：

1. PR：`package.json` 去掉 `-rc.N` → `X.Y.Z`；CHANGELOG Unreleased → 正式条目 → CI 绿 → 合 main
2. main 上：`git tag v$VERSION && git push origin v$VERSION`
3. 等到绿；验收 Latest 含 `latest-mac.yml` + arm64/x64 zip/dmg，且博客 job 已推到 `runloom/pier-website`（无条目或已存在则跳过）

#### B3c 直接发布（跳过候选）

仅响应显式触发词；默认触发（发版）恒走候选，禁止自行降级到此路径。
适用场景示例：早期无用户基础阶段、线上严重缺陷需立即修复。

1. 变更经 PR 合入 main；本地 preflight 与远程 CI 与常规一致（不减验证）
2. bump 正式 `X.Y.Z`（跳过 rc）→ tag → 现有 Latest 路径
3. 收尾报告标注：「直接发布，未经候选观察」+ 本次动机摘要

### B4 收尾

- pull 最新 main，确认 bump / CHANGELOG / 索引都在
- 正式版：确认 `https://pier.codes/blog/` 出现该版本（或 Actions 博客 job 已跳过/成功）
- 向用户报告：PR、插件 tag、宿主 tag 与 channel（candidate / stable；直接发布须标注）、官网博客、失败需人工项

---

## CI 怎么修

1. `gh run view <id> --log-failed` / `rg "FAIL  tests/"` 收集失败文件  
2. 本地：`pnpm preflight:ci` 或针对性 `pnpm exec vitest run <file>`  
3. 绿后一次 push；同一 flaky job 最多重跑一次，再红当实错修  

本地档位见 `pnpm preflight --help` / `docs/development.md`（push / merge / ci / full）。  
发布失败对照 `docs/app-release.md`（宿主）/ `docs/release.md`（插件）。

---

## 不要

- 功能未进 main 就打宿主 tag
- 先宿主、后「本车该发」的插件（用户只要宿主除外）
- 同 version 改已发布包内容（含候选 rc）
- 修只在 tag/旁支、不回 main
- 中途停下来问「要不要合并 / 发哪些插件 / 版本多少」（用户触发即授权全自动）
- 只靠 GitHub `release` 事件写官网博客（Release App 用 `GITHUB_TOKEN` 建 Release，不会触发其它 workflow）
- **默认路径直打无 rc 后缀的正式 `v*`**（正式 tag 只出自晋升 / 显式触发的直接发布）
- **候选 prerelease 占 Latest**（`verify-github-latest-isolation` + `gh release edit --latest=false` 守）
