# Git 提交主价值链 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Changes 面板在 uncommitted scope 下按 conflict/未暂存/已暂存分组并 section 锚定 diff，支持 Stage/Unstage All，用 AI 生成可编辑提交说明并 commit，提交后可 Push 或 Publish（`push -u`）。

**Architecture:** 插件侧编排。树与导航升级为 `sectionKey` 主锚点；整理复用 `git.stage`/`git.unstage`；提交区替换为 Composer，调用 `context.ai.generateText`；main 仅新增 `git.publish` 与 `preferences.gitCommit`。不引入可写 multibuffer、PR、hunk stage。

**Tech Stack:** Electron main/preload/renderer；git 内置插件；`@pier/ui` FileTree + DiffView；Vitest；既有 `ai-service` one-shot。

**Spec:** [docs/superpowers/specs/2026-07-22-git-commit-mainline-design.md](../specs/2026-07-22-git-commit-mainline-design.md)

## Global Constraints

- 默认 **不** `git commit` 计划步骤产物，除非用户本会话明确要求提交。
- 用户文案全走 i18n（`src/plugins/builtin/git/locales/{zh-CN,en}.json`）；禁实现词（one-shot、sectionKey 不进前台）。
- 失败：短失败 toast；技术详情 `showAppAlert` / 插件 `dialogs.alert`；禁止 `toast.*(…, { description })`。
- 交互密度 28px；颜色语义 token；destructive 确认走 `showAppConfirm` / `dialogs.confirm` + `intent`。
- `ai.generateText` prompt ≤ **12000** 字符；插件侧截断。
- Stage All：**含 untracked**，**跳过 conflict**；paths 非空才调用 stage/unstage。
- 不改 dockview 宿主边界；git 写操作保持 `git:write`。
- TDD：先测后码；每个 Task 结束时相关单测必须绿。

---

## File map

| 路径 | 职责 |
| --- | --- |
| `src/plugins/builtin/git/renderer/git-review-tree.tsx` | 分组树模型：组头 + section 节点 |
| `src/plugins/builtin/git/renderer/git-review-tree-section.ts` | section 节点 id / 解析纯函数 |
| `src/plugins/builtin/git/renderer/use-git-review-navigation.ts` | 导航主锚点改为 sectionKey（仍带 entryKey 供 document demand） |
| `src/plugins/builtin/git/renderer/git-review-content.tsx` | openPath → openSection；diff 排序 |
| `src/plugins/builtin/git/renderer/git-review-document-projection.ts` | 投影排序 conflict→unstaged→staged；可选保留 firstSection 仅兼容 |
| `src/plugins/builtin/git/renderer/git-review-tree-actions.ts` | 组语义动作；Stage/Unstage All 命令 |
| `src/plugins/builtin/git/renderer/git-review-tree-toolbar.tsx` | 全部暂存/取消暂存 UI |
| `src/plugins/builtin/git/renderer/git-stage-all.ts` | 从 index 收集 paths |
| `src/plugins/builtin/git/renderer/git-commit-prompt.ts` | prompt 装配/截断/normalize |
| `src/plugins/builtin/git/renderer/git-commit-composer-model.ts` | Composer 状态机 |
| `src/plugins/builtin/git/renderer/git-commit-composer.tsx` | UI 替换 `git-commit-form.tsx` |
| `src/plugins/builtin/git/renderer/git-post-commit-remote.ts` | push vs publish 决策 |
| `src/plugins/builtin/git/renderer/git-changes-panel.tsx` | 挂 Composer + toolbar |
| `src/plugins/builtin/git/manifest.ts` | 新命令 id |
| `src/plugins/builtin/git/locales/*.json` | 文案 |
| `src/shared/contracts/preferences.ts` | `gitCommit` 偏好 |
| `src/main/services/preferences-service.ts` | PATCHABLE_KEYS |
| `src/shared/contracts/git-commands.ts` + git-service/ops/preload/host-git | `publish` |
| `tests/unit/renderer/git-*.test.ts(x)` | 各层单测 |

---

### Task 1: B0a — section 节点模型与分组树

**Files:**
- Create: `src/plugins/builtin/git/renderer/git-review-tree-section.ts`
- Modify: `src/plugins/builtin/git/renderer/git-review-tree.tsx`
- Test: `tests/unit/renderer/git-review-tree-model.test.ts`

**Interfaces:**
- Produces:
  - `type GitReviewTreeFileRef = { entryKey: string; path: string; sectionKey: string; group: GitReviewGroup; status: GitReviewFileStatus }`
  - `function makeReviewTreeNodeId(sectionKey: string): string` — 稳定 id，避免与真实 path 碰撞（前缀 `section:`）
  - `function parseReviewTreeNodeId(id: string): { sectionKey: string } | null`
  - `function gitReviewTreeModel(entries, collidingFileLabel): { items: PierFileTreeItem[]; fileRefByNodeId: ReadonlyMap<string, GitReviewTreeFileRef>; groupCounts: { conflict: number; unstaged: number; staged: number } }`
- Group order (uncommitted): `conflict` → `unstaged` → `staged`. Untracked slots live under unstaged (status distinguishes).
- Group headers: `kind: "directory"`, path like `group:unstaged`, `hasChildren: true`, not selectable for diff (layout ignores open on group).
- File rows: one per `renderSlot` in those groups; `path` display can stay relative path under group; **node identity for selection/open is nodeId/sectionKey**, not path alone.
- Same git path may appear twice (unstaged + staged) with different node ids.

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/renderer/git-review-tree-model.test.ts
import { describe, expect, it } from "vitest";
import { gitReviewTreeModel } from "@plugins/builtin/git/renderer/git-review-tree.tsx";
import {
  makeReviewTreeNodeId,
  parseReviewTreeNodeId,
} from "@plugins/builtin/git/renderer/git-review-tree-section.ts";

function entry(partial: {
  path: string;
  entryKey?: string;
  slots: Array<{ group: "unstaged" | "staged" | "conflict"; sectionKey: string; status?: "modified" | "added" | "conflicted" }>;
}) {
  return {
    entryKey: partial.entryKey ?? `ek:${partial.path}`,
    path: partial.path,
    oldPaths: [] as string[],
    status: partial.slots[0]?.status ?? "modified",
    renderSlots: partial.slots.map((s) => ({
      group: s.group,
      sectionKey: s.sectionKey,
      status: s.status ?? "modified",
      targetPath: partial.path,
      oldPath: null,
    })),
  };
}

describe("gitReviewTreeModel grouped", () => {
  it("emits group directories then section file rows; half-staged path twice", () => {
    const model = gitReviewTreeModel(
      [
        entry({
          path: "a.ts",
          slots: [
            { group: "unstaged", sectionKey: "sec:u:a" },
            { group: "staged", sectionKey: "sec:s:a" },
          ],
        }),
        entry({
          path: "new.ts",
          slots: [{ group: "unstaged", sectionKey: "sec:u:new", status: "added" }],
        }),
      ],
      (name) => `(file) ${name}`
    );
    const paths = model.items.map((i) => i.path);
    expect(paths.some((p) => p.includes("group:unstaged") || p.startsWith("group:"))).toBe(true);
    const refs = [...model.fileRefByNodeId.values()];
    expect(refs.filter((r) => r.path === "a.ts")).toHaveLength(2);
    expect(refs.map((r) => r.sectionKey).sort()).toEqual([
      "sec:s:a",
      "sec:u:a",
      "sec:u:new",
    ].sort());
    expect(model.groupCounts).toEqual({ conflict: 0, unstaged: 2, staged: 1 });
  });

  it("roundtrips node id", () => {
    const id = makeReviewTreeNodeId("sec:u:a");
    expect(parseReviewTreeNodeId(id)).toEqual({ sectionKey: "sec:u:a" });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm exec vitest run tests/unit/renderer/git-review-tree-model.test.ts`

Expected: FAIL (exports/shape missing)

- [ ] **Step 3: Implement `git-review-tree-section.ts` + rewrite `gitReviewTreeModel`**

Implementation notes:
- Keep directory ancestors **within** a group if you still want folder nesting under each group; v1 may flatten files under group only (simpler). Prefer **flatten under group** for v1 unless existing tests require nested dirs — check `git-review-panels` / e2e; if nested expected, nest path segments under `group:{id}/...` display path but keep fileRef keyed by node id.
- `PierFileTreeItem.path` must be unique in the tree: use `group:unstaged/a.ts` vs `group:staged/a.ts` as item.path, store real git path on fileRef.
- Do not put `committed` group in uncommitted model (entries won’t have it).

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm exec vitest run tests/unit/renderer/git-review-tree-model.test.ts`

- [ ] **Step 5: Fix compile fallout in consumers that use `entryByPath` only**

Update types: replace or extend `entryByPath` with `fileRefByNodeId` + helper `getFileRefForTreePath(path)`. Touch:
- `git-review-tree-context-menu.ts`
- `git-review-panel-layout.tsx`
- `git-review-document-ui-state.ts`
- `git-review-content.tsx` (temporary: map path → first matching ref until Task 2)

Run: `pnpm exec vitest run tests/unit/renderer/git-review-tree-actions.test.ts tests/unit/renderer/git-review-panels.test.tsx`

- [ ] **Step 6: Optional commit** (skip unless user asks)

---

### Task 2: B0a — section 导航与 diff 排序

**Files:**
- Modify: `src/plugins/builtin/git/renderer/use-git-review-navigation.ts`
- Modify: `src/plugins/builtin/git/renderer/git-review-content.tsx`
- Modify: `src/plugins/builtin/git/renderer/git-review-document-projection.ts`（items 排序）
- Modify: `src/plugins/builtin/git/renderer/git-review-document-view.tsx` / `git-review-panel-layout.tsx`（`onOpenPath` → `onOpenNode` 或扩展参数）
- Test: `tests/unit/renderer/git-review-navigation.test.ts`（扩展）
- Test: `tests/unit/renderer/git-review-document-projection.test.ts`（排序）

**Interfaces:**
- Produces:
  - `beginNavigation(target: { entryKey: string; sectionKey: string }): void`
  - `openTreeNode(nodePathOrId: string): void` in content: resolve fileRef → beginNavigation
- Consumes: `fileRefByNodeId` / parse node id
- Diff item order: slots ordered by `GIT_REVIEW_GROUP_ORDER` then path
- Selection highlight follows section item id (`sectionKey`)

- [ ] **Step 1: Failing tests**

```ts
// projection order
it("orders projected items conflict, unstaged, staged", () => {
  // build two resources / mock projection input with mixed slots
  // expect item ids order by group
});

// navigation: when beginNavigation({ entryKey, sectionKey: staged }),
// currentProjectedTarget uses that sectionKey not firstSection
```

Extend navigation unit tests to pass explicit sectionKey and assert `findReviewNavigationTarget` / projected target uses it.

- [ ] **Step 2: Run — FAIL**

Run: `pnpm exec vitest run tests/unit/renderer/git-review-navigation.test.ts tests/unit/renderer/git-review-document-projection.test.ts`

- [ ] **Step 3: Implement**

- Change `PendingReviewNavigation` to include `sectionKey: string` (required).
- Replace reads of `firstSectionIdByEntryKeyRef.get(entryKey)` for **user intent** with `navigation.sectionKey`.
- Keep document demand on `entryKey` (load whole file document still).
- `git-review-content` `openPath`: if tree still passes path, resolve via `fileRefByNodeId` / path map; prefer passing section identity from layout click handler.
- Wire FileTree `onOpen` to node that carries section.

- [ ] **Step 4: Run — PASS** + smoke existing:

Run: `pnpm exec vitest run tests/unit/renderer/git-review-navigation.test.ts tests/unit/renderer/git-review-document-projection.test.ts tests/unit/renderer/use-git-review-navigation-demand.test.ts tests/unit/renderer/git-review-panels.test.tsx`

- [ ] **Step 5: Optional commit**

---

### Task 3: B0b — Stage/Unstage All 纯函数 + 命令/工具条

**Files:**
- Create: `src/plugins/builtin/git/renderer/git-stage-all.ts`
- Create: `src/plugins/builtin/git/renderer/git-review-tree-toolbar.tsx`
- Modify: `src/plugins/builtin/git/renderer/git-review-tree-actions.ts`
- Modify: `src/plugins/builtin/git/manifest.ts`
- Modify: `src/plugins/builtin/git/locales/zh-CN.json`, `en.json`
- Modify: `src/plugins/builtin/git/renderer/git-changes-panel.tsx` / layout to host toolbar
- Test: `tests/unit/renderer/git-stage-all.test.ts`
- Test: extend `tests/unit/renderer/git-review-tree-actions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function collectStageAllPaths(entries: readonly GitReviewIndexEntry[]): {
    paths: string[];
    skippedConflicts: number;
  }
  export function collectUnstageAllPaths(entries: readonly GitReviewIndexEntry[]): string[]
  ```
- Stage paths: unique `targetPath` from slots where `group === "unstaged"` (includes untracked/added). Skip entries that only have conflict or skip conflict slots only.
- Unstage: unique paths from `group === "staged"`.
- Commands: `pier.git.review.stageAll`, `pier.git.review.unstageAll`.

- [ ] **Step 1: Failing unit tests for collectors**

```ts
it("stage all includes untracked and skips conflict paths", () => {
  const { paths, skippedConflicts } = collectStageAllPaths([
    /* unstaged mod, unstaged added, conflict-only, staged-only */
  ]);
  expect(paths.sort()).toEqual(["a.ts", "new.ts"]);
  expect(skippedConflicts).toBe(1);
});

it("unstage all lists staged paths only", () => { /* ... */ });
```

- [ ] **Step 2: Implement collectors + register actions calling `context.git.stage/unstage`**

On success with `skippedConflicts > 0`, surface inline warning via callback/props to toolbar (or toast once with i18n `ui.stageAllSkippedConflicts`). Prefer inline near toolbar per spec P-T4.

- [ ] **Step 3: Toolbar UI**

```tsx
// git-review-tree-toolbar.tsx — two outline Buttons h density default, disabled when paths empty / busy
```

Mount above tree in `git-review-panel-layout` or changes sidebar header.

- [ ] **Step 4: Tests PASS**

Run: `pnpm exec vitest run tests/unit/renderer/git-stage-all.test.ts tests/unit/renderer/git-review-tree-actions.test.ts`

- [ ] **Step 5: Optional commit**

---

### Task 4: B1 — commit prompt 纯函数

**Files:**
- Create: `src/plugins/builtin/git/renderer/git-commit-prompt.ts`
- Test: `tests/unit/renderer/git-commit-prompt.test.ts`

**Interfaces:**
```ts
export const GIT_COMMIT_PROMPT_MAX_CHARS = 12_000;

export function buildCommitMessagePrompt(input: {
  branchName: string | null;
  commitInstructions: string;
  recentSubjects: readonly string[]; // ≤5
  stagedDiffText: string;
}): string

export function normalizeCommitMessage(raw: string): string | null
// strip ``` fences, "Commit message:" prefix, trim; null if empty/garbage
```

- [ ] **Step 1: Tests**

```ts
it("keeps prompt length <= 12000 even with huge diff", () => {
  const prompt = buildCommitMessagePrompt({
    branchName: "feat/x",
    commitInstructions: "use conventional commits",
    recentSubjects: ["fix: a", "feat: b"],
    stagedDiffText: "x".repeat(50_000),
  });
  expect(prompt.length).toBeLessThanOrEqual(12_000);
  expect(prompt).toMatch(/truncated/i);
});

it("normalize strips fences and rejects empty", () => {
  expect(normalizeCommitMessage("```\nfix: x\n```")).toBe("fix: x");
  expect(normalizeCommitMessage("   ")).toBeNull();
});
```

Prompt body must instruct: plain commit message only; subject ≤72 target; follow recent log style; honor commitInstructions.

- [ ] **Step 2: Implement + PASS**

Run: `pnpm exec vitest run tests/unit/renderer/git-commit-prompt.test.ts`

---

### Task 5: B1 — Composer model 状态机

**Files:**
- Create: `src/plugins/builtin/git/renderer/git-commit-composer-model.ts`
- Test: `tests/unit/renderer/git-commit-composer-model.test.ts`

**Interfaces:**
```ts
export type ComposerPhase =
  | "needs_stage"
  | "ready_staged"
  | "generating"
  | "draft_clean"
  | "draft_dirty"
  | "committing"
  | "post_commit";

export interface ComposerState { /* phase, message, lastAiMessage, stagedIdentity, error, postCommitoid?, busy flags */ }

export function reduceComposer(state: ComposerState, action: ComposerAction): ComposerState

export function computeStagedIdentity(input: {
  stagedPaths: readonly string[];
  stagedCount: number;
  indexGeneration: number;
}): string

export function shouldAutoGenerate(input: {
  autoGenerate: boolean;
  aiConfigured: boolean;
  phase: ComposerPhase;
  messageDirty: boolean;
  stagedCount: number;
  stagedIdentity: string;
  lastGeneratedIdentity: string | null;
}): boolean
```

Rules from spec: dirty ⇒ no auto overwrite; generationId monotonic handled in UI effect not necessarily in reduce.

- [ ] **Step 1: Table-driven tests for reduce + shouldAutoGenerate**
- [ ] **Step 2: Implement + PASS**

Run: `pnpm exec vitest run tests/unit/renderer/git-commit-composer-model.test.ts`

---

### Task 6: B1 — preferences `gitCommit` + settings UI

**Files:**
- Modify: `src/shared/contracts/preferences.ts`
- Modify: `src/main/services/preferences-service.ts` (`PATCHABLE_KEYS`)
- Modify: git plugin settings contribution (find existing settings registration under `src/plugins/builtin/git/` — if only worktree key exists, add configuration properties in `manifest.ts` / settings module mirroring worktree branch prompt pattern)
- Locales for settings labels
- Test: unit parse defaults for `gitCommit` if preferences tests exist; else add `tests/unit/shared/git-commit-preferences.test.ts`

**Schema:**
```ts
gitCommit: z.object({
  autoGenerateMessage: z.boolean().default(true),
  commitInstructions: z.string().max(4000).default(""),
}).default({ autoGenerateMessage: true, commitInstructions: "" })
```

- [ ] **Step 1: Test default + patch roundtrip if pattern exists**
- [ ] **Step 2: Wire PATCHABLE_KEYS + UI checkbox/textarea in Card**
- [ ] **Step 3: typecheck slice**

Run: `pnpm exec vitest run tests/unit/shared/git-commit-preferences.test.ts` (or project equivalent)

---

### Task 7: B1 — GitCommitComposer UI + 替换表单

**Files:**
- Create: `src/plugins/builtin/git/renderer/git-commit-composer.tsx`
- Modify: `src/plugins/builtin/git/renderer/git-changes-panel.tsx`（替换 `GitCommitForm`）
- Delete or thin-wrap: `git-commit-form.tsx`（删除前确保无其它引用）
- Locales: all P-C* strings from spec §9
- Test: `tests/unit/renderer/git-commit-composer.test.tsx`

**Behavior:**
1. stagedCount===0 && hasUnstaged → P-C0 needs_stage + Stage All button calling same handler as toolbar.
2. stagedCount>0 → show summary (files count; ± lines optional v1: skip numstat if costly — **files count only** unless `getDiffSummary({staged:true})` already cheap).
3. On mount/identity change: if `shouldAutoGenerate`, call:
   - `ai.status()` once cache
   - `getDiffText({ staged: true })`, `getLog({ maxCount: 5 })`, branch from `getStatus`
   - `generateText({ projectRootPath: gitRoot, prompt })`
   - apply normalize; generation seq guard
4. Regenerate when dirty → `dialogs.confirm` / `showAppConfirm` equivalent via `context.dialogs.confirm`
5. Commit → `git.commit`; success → phase post_commit; clear message
6. AI unavailable → inline, no alert
7. testids: `git-commit-composer`, `git-commit-generate`, `git-commit-submit`

- [ ] **Step 1: Component tests with mocked `context.git` / `context.ai`**

Cover: auto-generate fill; dirty blocks auto; commit calls git.commit; unavailable copy.

- [ ] **Step 2: Implement composer + panel wire**
- [ ] **Step 3: PASS**

Run: `pnpm exec vitest run tests/unit/renderer/git-commit-composer.test.tsx tests/unit/renderer/git-plugin.test.tsx`

---

### Task 8: B2 — `git.publish` API

**Files:**
- Modify: `src/main/services/git-operations.ts` — `publishBranch`
- Modify: `src/main/services/git-service.ts` + commands schema `src/shared/contracts/git-commands.ts`
- Modify: `src/main/app-core/git-commands.ts`
- Modify: `src/preload/git-api.ts`, `src/renderer/lib/plugins/host-git-context.ts`
- Plugin API type if separate from preload
- Test: `tests/unit/main/git-publish.test.ts` (or existing git-operations test folder pattern)

**Semantics:**
```ts
export async function publishBranch(execGit, cwd): Promise<GitRemoteOperationResult> {
  // reject detached (rev-parse symbolic-ref fails)
  // remote = origin if exists else unique remote else unavailable message
  // branch = current short name
  // git push -u <remote> <branch>
}
```

- [ ] **Step 1: Unit tests with fake execGit**
  - happy path args `["push", "-u", "origin", "feat"]`
  - no remotes → unavailable
  - detached → unavailable
- [ ] **Step 2: Implement end-to-end IPC**
- [ ] **Step 3: PASS**

Run: `pnpm exec vitest run tests/unit/main/git-publish.test.ts` (adjust path to repo convention under `tests/unit`)

---

### Task 9: B2 — 提交后 Push/Publish UI

**Files:**
- Create: `src/plugins/builtin/git/renderer/git-post-commit-remote.ts`
- Modify: `git-commit-composer.tsx`
- Test: `tests/unit/renderer/git-post-commit-remote.test.ts` + composer post-commit tests

**Interfaces:**
```ts
export type PostCommitRemoteAction =
  | { kind: "push" }
  | { kind: "publish"; branch: string; remoteLabel: string }
  | { kind: "none"; reason: "detached" | "synced" };

export function resolvePostCommitRemoteAction(status: GitStatus): PostCommitRemoteAction
// detached HEAD → none detached
// upstream null → publish
// ahead > 0 → push
// else none synced
```

- [ ] **Step 1: Tests for resolver**
- [ ] **Step 2: Composer post_commit buttons call push/publish; errors via dialogs.alert**
- [ ] **Step 3: 「查看该提交」— if oid available, `onSelectTarget({ kind: "commit", oid })` from panel props; if oid unknown, hide button v1**
- [ ] **Step 4: PASS**

---

### Task 10: B3 — 命令面板、文案、回归

**Files:**
- manifest + actions already partly done — ensure stageAll/unstageAll/generateMessage registered
- `pier.git.commit.generateMessage` focuses/triggers composer generate (custom event or store callback)
- Locales complete both zh-CN and en
- Run broader tests

- [ ] **Step 1: Register generateMessage command if missing**
- [ ] **Step 2: Run targeted suites**

```bash
pnpm exec vitest run tests/unit/renderer/git-review-tree-model.test.ts \
  tests/unit/renderer/git-review-navigation.test.ts \
  tests/unit/renderer/git-stage-all.test.ts \
  tests/unit/renderer/git-commit-prompt.test.ts \
  tests/unit/renderer/git-commit-composer-model.test.ts \
  tests/unit/renderer/git-commit-composer.test.tsx \
  tests/unit/renderer/git-post-commit-remote.test.ts \
  tests/unit/renderer/git-review-tree-actions.test.ts \
  tests/unit/renderer/git-review-panels.test.tsx
```

- [ ] **Step 3: `pnpm typecheck` on touched packages if full check too heavy; fix errors**
- [ ] **Step 4: Manual checklist (document in PR, don’t automate)**
  - 半暂存两行两点
  - Stage All 含 untracked、跳过 conflict
  - 无 agent 手写提交
  - 有 agent 自动草稿
  - 无 upstream Publish
  - detached 无推送

---

## Spec coverage self-check

| Spec 项 | Task |
| --- | --- |
| §2.3 分组树 + section 锚定 | 1–2 |
| Stage/Unstage All + P-T* | 3 |
| AI prompt/截断/normalize | 4 |
| Composer 状态/自动生成/脏 | 5–7 |
| gitCommit 偏好 | 6 |
| UI 替换 GitCommitForm | 7 |
| publish + 提交后远端 | 8–9 |
| 命令/文案/回归 | 10 |
| 不做 PR/hunk/Zed multibuffer | 全局约束 |
| L1–L4 | 3+7+9 |

## Placeholder scan

无 TBD；oid「查看该提交」允许 oid 不可用时隐藏。± 行摘要 v1 可选跳过（Task 7 已写明）。

## Type consistency

- 导航：`{ entryKey, sectionKey }`
- 树：`fileRefByNodeId` + `GitReviewTreeFileRef`
- 远端：`PostCommitRemoteAction` / `publish(cwd)`
- 偏好：`gitCommit.autoGenerateMessage` / `commitInstructions`

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-git-commit-mainline.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans and checkpoints  

**Which approach?**