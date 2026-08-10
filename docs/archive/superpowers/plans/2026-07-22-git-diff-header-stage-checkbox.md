# Git Diff Header Stage Checkbox Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. Do **not** git commit unless the user explicitly asks.

**Goal:** (shipped as +/- header actions, not checkbox)

**Goal:** Diff 文件头去掉分组路径前缀，在类型图标前提供可点 Stage checkbox（勾选=已暂存）。

**Architecture:** projection 产出纯路径 + `stageControl`；`packages/ui` PierDiffView header prefix 渲染 checkbox 并回调；git 插件接 `onToggleStage` 调现有 stage/unstage。

**Tech Stack:** React 19, packages/ui PierDiffView, git builtin plugin, Vitest

## Global Constraints

- 路径不得再含 `groupLabel ·` 前缀
- conflict / committed 不显示 checkbox
- UI 包不 import git；只消费 item 元数据 + 回调
- 用户文案走 i18n；失败要有面向用户反馈
- 不自动 git commit

---

### Task 1: Projection — pure path + stageControl

**Files:**
- Modify: `packages/ui/src/diff-view-items.ts`（类型）
- Modify: `src/plugins/builtin/git/renderer/git-review-document-projection.ts`
- Test: `tests/unit/renderer/git-review-document-projection.test.ts`

- [x] 扩展 `PierDiffViewItem`：`stageControl?: { state: "staged" | "unstaged" } | null`
- [x] projection：`path = slot.targetPath`；unstaged/staged 设 stageControl；conflict/committed 为 null/省略
- [x] 单测：半暂存两行同 path、不同 stageControl；无分组前缀

### Task 2: UI header checkbox

**Files:**
- Modify: `packages/ui/src/diff-view-collapse.tsx` 或新建 `diff-view-stage-checkbox.tsx`
- Modify: `packages/ui/src/use-diff-view-headers.tsx`
- Modify: `packages/ui/src/diff-view.tsx`（props: labels + onToggleStage）
- Test: component/unit covering header prefix

- [x] header prefix：Collapse 后渲染 Stage checkbox（仅有 stageControl 时）
- [x] 点击 stopPropagation；调用 `onToggleStage(itemId)`
- [x] labels：stageChanges / unstageChanges
- [x] busy 可选：由父级通过 items 重投或本地 Set（优先父级）

### Task 3: Git plugin wiring

**Files:**
- Modify: `src/plugins/builtin/git/renderer/git-review-code-view.tsx`（或 document-view/content）
- Modify: locales en/zh-CN
- Test: panels or actions coverage for toggle

- [x] 传入 onToggleStage：按 sectionKey/item id 找 slot，stage/unstage
- [x] 错误 showError；可选 busy 状态
- [x] i18n aria labels

### Task 4: Verify

- [x] `pnpm exec vitest run` 相关 projection + panels + ui tests
- [x] 手测清单：半暂存、目录右键仍可用、commit scope 无 checkbox
