# README Text-only Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将根 README 收口为无需截图即可解释 Pier 产品定位、核心工作流和真实能力的纯文字入口。

**Architecture:** 只调整文档叙事和删除本轮截图资产，不改变产品能力。Canvas 下沉为核心能力项；所有仅为截图产生的运行时代码同步撤回，已经核实的 CLI 手册与文档索引改进继续保留。

**Tech Stack:** GitHub Flavored Markdown、pnpm、Vitest

**Spec:** `docs/superpowers/specs/2026-08-19-readme-text-only-refresh-design.md`

## Global Constraints

- 产品定位固定为“本地 AI 开发工作台”。
- 保留原生终端、会话状态、Git 工作树、文件与变更、可保存布局、Canvas 的真实能力边界。
- 不宣称任务生命周期、任务台账、看板或自动调度。
- 不新增或生成替代图片、SVG、ASCII 图或视觉占位。
- 保留不依赖截图的 CLI 手册、文档索引和开发指南改进。

---

### Task 1: 收口根 README 并删除截图资产

**Files:**
- Modify: `README.md`
- Delete: `assets/readme/agents.png`
- Delete: `assets/readme/review.png`
- Delete: `assets/readme/canvas.png`

**Interfaces:**
- Consumes: 设计稿规定的“定位 → 为什么需要 → 核心工作流 → 能力 → 边界”叙事。
- Produces: 不依赖图片的 GitHub 仓库产品入口。

- [ ] **Step 1: 重写 README 首屏**

将原有三个截图章节合并为“为什么是 Pier”和“核心工作流”，用短段落与四个步骤说明原生 CLI、跨会话状态、回到终端和 Git 审查之间的关系。

- [ ] **Step 2: 合并 Canvas 能力**

把 Canvas 作为核心能力列表中的一项，明确它是随项目保存的可预览页面，不是任务编排器。

- [ ] **Step 3: 删除截图资产**

删除 `assets/readme/agents.png`、`assets/readme/review.png`、`assets/readme/canvas.png`；如果目录为空，一并移除目录。

- [ ] **Step 4: 验证 README 不含图片引用**

Run: `rg -n 'assets/readme|!\\[|<img' README.md`

Expected: 无输出，退出状态为 1。

### Task 2: 撤回截图专用产品改动

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `src/renderer/lib/agent-runtime/index-display-status.ts`
- Modify: `tests/unit/renderer/agent/index-display-status.test.ts`

**Interfaces:**
- Consumes: 本轮截图捕获过程中新增的会话标题保留逻辑、对应测试和变更日志条目。
- Produces: 与本次纯文档任务一致的最小产品代码差异。

- [ ] **Step 1: 删除截图专用实现**

从本地前台活动覆盖对象中移除本轮新增的 `sessionTitle` 与 `sessionTitleSource` 复制逻辑。

- [ ] **Step 2: 删除对应单测**

删除 `keeps the product session title while overlaying live status` 测试，保留同文件其他既有测试。

- [ ] **Step 3: 删除对应变更日志**

移除 `[Unreleased]` 下仅描述该实现的 `Fixed` 条目。

- [ ] **Step 4: 验证三处不再有差异**

Run: `git diff -- CHANGELOG.md src/renderer/lib/agent-runtime/index-display-status.ts tests/unit/renderer/agent/index-display-status.test.ts`

Expected: 无输出。

### Task 3: 验证并独立审查

**Files:**
- Verify: `README.md`
- Verify: `docs/README.md`
- Verify: `docs/development.md`
- Verify: `.pier/canvases/pier-cli-user-manual/**`
- Verify: `tests/unit/cli/cli-surface-governance.test.ts`

**Interfaces:**
- Consumes: Task 1 与 Task 2 的最终工作区。
- Produces: 可交付的文档差异与独立审查结论。

- [ ] **Step 1: 检查受跟踪工作树差异的补丁格式**

Run: `git diff --check`

Expected: 退出状态 0。

- [ ] **Step 1a: 检查未跟踪 Markdown 文件的空白**

分别运行 `git diff --no-index --check /dev/null .pier/canvases/pier-cli-user-manual/README.md`、`git diff --no-index --check /dev/null docs/superpowers/plans/2026-08-19-readme-text-only-refresh.md` 与 `git diff --no-index --check /dev/null docs/superpowers/specs/2026-08-19-readme-text-only-refresh-design.md`。

Expected: 每个命令退出状态为 1（文件与 `/dev/null` 不同）；无输出表示未发现空白错误。

- [ ] **Step 2: 检查本地 Markdown 链接**

扫描本轮涉及的 Markdown 文件，解析相对链接并确认目标存在；忽略 `http://`、`https://`、`mailto:` 和页内锚点。

Expected: 缺失链接为 0。

- [ ] **Step 3: 运行 CLI 手册治理测试**

Run: `pnpm exec vitest run tests/unit/cli/cli-surface-governance.test.ts`

Expected: 全部通过。

- [ ] **Step 4: 独立审查**

由子 agent 只读检查：产品定位是否准确、首屏是否简洁、功能声明是否有源码依据、是否仍有图片或截图专用改动。

Expected: 无 Critical 或 Important；发现问题则修复并重新审查。
