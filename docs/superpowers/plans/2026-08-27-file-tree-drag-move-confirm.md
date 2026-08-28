# 目录树拖拽移动确认 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 目录树拖拽 drop 后先弹确认，取消（或确认异常）时回滚树模型，杜绝误触真实移动文件。

**Architecture:** 在 files 插件 `action-utils.ts` 新增纯逻辑协调器 `handleTreeDragMoves` + 确认函数 `confirmTreeMoves`；`sidebar.tsx` 的 `handleMovePaths` 改为注入真实依赖调用协调器；取消复用现有 `rollbackFilesTreeModelMove`（与磁盘失败回滚同路径），不新增回滚机制、不动 `@pierre/trees`。

**Tech Stack:** TypeScript strict · Vitest 4 · i18next（插件 locale JSON）

## Global Constraints

- 设计依据：`docs/superpowers/specs/2026-08-27-file-tree-drag-move-confirm-design.md`。
- **全程不执行 `git commit` / `git push` / 创建 PR**（AGENTS.md 安全边界）；任务收口 = 测试 + typecheck 通过。
- 弹窗规范：`intent: "default"` 显式必填；**禁止传 `size`**（facade 固定 `sm`）；移动不是破坏性操作，**禁止** `intent: "destructive"`；用户可见文案全部走 i18n key + 英文 fallback，禁止内联用户串。
- 不新增 `src/plugins/builtin/files/renderer/tree/` 源文件（目录密度棘轮）；协调器放既有 `action-utils.ts`；单文件 ≤500 行（改后约 315 行）。
- 不动 `@pierre/trees`（不改 `node_modules`、不新增 pnpm patch）。
- 测试遵循 `tests/unit/renderer/files/tree/actions.test.ts` 的 mock context 惯例（`vi.fn` 类型化 facade、`as unknown as RendererPluginContext`）。
- locale `messages` 键按 ASCII 排序：`filePanel.tree.moveConfirm.*` 插入到 `filePanel.tree.moved` **之前**（`'C'(67) < 'd'(100)`）。

---

### Task 1: confirmTreeMoves / handleTreeDragMoves + 单测 + i18n

**Files:**
- Create: `tests/unit/renderer/files/tree/move-confirm.test.ts`
- Modify: `src/plugins/builtin/files/renderer/tree/action-utils.ts`（现 230 行，文件尾部追加）
- Modify: `src/plugins/builtin/files/locales/en.json`
- Modify: `src/plugins/builtin/files/locales/zh-CN.json`
- Modify: `src/plugins/builtin/files/locales/ja.json`
- Modify: `src/plugins/builtin/files/locales/ko.json`

**Interfaces:**
- Consumes: `RendererPluginContext["dialogs"]["confirm"]`（`{ body?, cancelLabel?, confirmLabel?, intent, title } => Promise<boolean>`，intent 必填）；`createFilesTranslate(context)` 返回 `FilesTranslate = (key, fallback?, values?) => string`；`PierFileTreeMove = { from: string; to: string }`（`@pier/ui/file/tree.tsx`）；同文件已有 `basename` / `dirnameRelative`。
- Produces（Task 2 依赖的确切签名）:
  - `confirmTreeMoves(input: { context: RendererPluginContext; moves: readonly PierFileTreeMove[]; t: FilesTranslate }): Promise<boolean>`
  - `handleTreeDragMoves(input: { confirm: (moves: readonly PierFileTreeMove[]) => Promise<boolean>; moves: readonly PierFileTreeMove[]; performMove: (from: string, to: string) => Promise<void>; rollback: (target: { removedPaths: readonly string[]; restoredPaths: readonly string[] }) => void }): Promise<void>`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/renderer/files/tree/move-confirm.test.ts`：

```ts
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  confirmTreeMoves,
  handleTreeDragMoves,
} from "@plugins/builtin/files/renderer/tree/action-utils.ts";
import { createFilesTranslate } from "@plugins/builtin/files/renderer/i18n.ts";
import { describe, expect, it, vi } from "vitest";

function makeContext() {
  const confirm = vi.fn<RendererPluginContext["dialogs"]["confirm"]>(
    async () => true
  );
  const context = {
    dialogs: { confirm },
    i18n: {
      t: vi.fn(
        (
          _key: string,
          values?: Record<string, number | string>,
          fallback?: string
        ) => {
          let text = fallback ?? _key;
          for (const [name, value] of Object.entries(values ?? {})) {
            text = text.replaceAll(`{{${name}}}`, String(value));
          }
          return text;
        }
      ),
    },
  } as unknown as RendererPluginContext;
  return { confirm, context };
}

describe("confirmTreeMoves", () => {
  it("asks once with the single-move body and returns the dialog result", async () => {
    const { confirm, context } = makeContext();
    confirm.mockResolvedValue(false);

    const result = await confirmTreeMoves({
      context,
      moves: [{ from: "src/a.ts", to: "src/utils/a.ts" }],
      t: createFilesTranslate(context),
    });

    expect(result).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      body: 'Move "a.ts" into "utils"?',
      cancelLabel: "Cancel",
      confirmLabel: "Move",
      intent: "default",
      title: "Move",
    });
  });

  it("uses the multi-move body with count", async () => {
    const { confirm, context } = makeContext();

    await confirmTreeMoves({
      context,
      moves: [
        { from: "a.ts", to: "lib/a.ts" },
        { from: "b.ts", to: "lib/b.ts" },
      ],
      t: createFilesTranslate(context),
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Move 2 items into "lib"?' })
    );
  });

  it("names the project root for root drops", async () => {
    const { confirm, context } = makeContext();

    await confirmTreeMoves({
      context,
      moves: [{ from: "src/a.ts", to: "a.ts" }],
      t: createFilesTranslate(context),
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Move "a.ts" into "project root"?' })
    );
  });

  it("skips the dialog when every move is a no-op", async () => {
    const { confirm, context } = makeContext();

    const result = await confirmTreeMoves({
      context,
      moves: [{ from: "a.ts", to: "a.ts" }],
      t: createFilesTranslate(context),
    });

    expect(result).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("handleTreeDragMoves", () => {
  it("performs each move after confirmation", async () => {
    const performMove = vi.fn(async (_from: string, _to: string) => undefined);
    const rollback = vi.fn();

    await handleTreeDragMoves({
      confirm: async () => true,
      moves: [
        { from: "a.ts", to: "lib/a.ts" },
        { from: "b.ts", to: "lib/b.ts" },
      ],
      performMove,
      rollback,
    });

    expect(performMove.mock.calls).toEqual([
      ["a.ts", "lib/a.ts"],
      ["b.ts", "lib/b.ts"],
    ]);
    expect(rollback).not.toHaveBeenCalled();
  });

  it("rolls the model back once when the user cancels", async () => {
    const performMove = vi.fn(async (_from: string, _to: string) => undefined);
    const rollback = vi.fn();

    await handleTreeDragMoves({
      confirm: async () => false,
      moves: [
        { from: "a.ts", to: "lib/a.ts" },
        { from: "b.ts", to: "lib/b.ts" },
      ],
      performMove,
      rollback,
    });

    expect(performMove).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith({
      removedPaths: ["lib/a.ts", "lib/b.ts"],
      restoredPaths: ["a.ts", "b.ts"],
    });
  });

  it("treats a confirm failure as cancel", async () => {
    const performMove = vi.fn(async (_from: string, _to: string) => undefined);
    const rollback = vi.fn();

    await handleTreeDragMoves({
      confirm: async () => {
        throw new Error("dialog gone");
      },
      moves: [{ from: "a.ts", to: "lib/a.ts" }],
      performMove,
      rollback,
    });

    expect(performMove).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith({
      removedPaths: ["lib/a.ts"],
      restoredPaths: ["a.ts"],
    });
  });

  it("does nothing when every move is a no-op", async () => {
    const confirm = vi.fn(async () => true);
    const performMove = vi.fn(async (_from: string, _to: string) => undefined);
    const rollback = vi.fn();

    await handleTreeDragMoves({
      confirm,
      moves: [{ from: "a.ts", to: "a.ts" }],
      performMove,
      rollback,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(performMove).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run tests/unit/renderer/files/tree/move-confirm.test.ts`
Expected: FAIL — `The requested module ... does not provide an export named 'confirmTreeMoves'`（或同类导入错误）。

- [ ] **Step 3: 实现 action-utils.ts**

`src/plugins/builtin/files/renderer/tree/action-utils.ts` 顶部 import 区加一行（保持 biome import 排序，`@pier/ui` 在 `@plugins` 之前）：

```ts
import type { PierFileTreeMove } from "@pier/ui/file/tree.tsx";
```

文件尾部（`notifyMoveWithUndo` 之后）追加：

```ts
function moveConfirmTarget(to: string, t: FilesTranslate): string {
  const dir = dirnameRelative(to);
  if (dir.length === 0) {
    return t("filePanel.tree.moveConfirm.rootTarget", "project root");
  }
  return basename(dir);
}

/**
 * 拖拽移动确认(VS Code explorer.confirmDragAndDrop 默认语义):执行真实 fs
 * move 前询问。库在 onDropComplete 前已先行移动树模型,取消由调用方回滚。
 */
export async function confirmTreeMoves(input: {
  context: RendererPluginContext;
  moves: readonly PierFileTreeMove[];
  t: FilesTranslate;
}): Promise<boolean> {
  const moves = input.moves.filter((move) => move.from !== move.to);
  const first = moves[0];
  if (!first) {
    return false;
  }
  const target = moveConfirmTarget(first.to, input.t);
  const body =
    moves.length === 1
      ? input.t(
          "filePanel.tree.moveConfirm.body",
          'Move "{{name}}" into "{{target}}"?',
          { name: basename(first.from), target }
        )
      : input.t(
          "filePanel.tree.moveConfirm.bodyMulti",
          'Move {{count}} items into "{{target}}"?',
          { count: moves.length, target }
        );
  return await input.context.dialogs.confirm({
    body,
    cancelLabel: input.t("filePanel.tree.moveConfirm.cancelLabel", "Cancel"),
    confirmLabel: input.t("filePanel.tree.moveConfirm.confirmLabel", "Move"),
    intent: "default",
    title: input.t("filePanel.tree.moveConfirm.title", "Move"),
  });
}

/**
 * 树内拖拽移动协调器:先确认,取消(或确认异常)一次性回滚库已先行应用的
 * 模型移动,确认后逐条执行真实 move。
 */
export async function handleTreeDragMoves(input: {
  confirm: (moves: readonly PierFileTreeMove[]) => Promise<boolean>;
  moves: readonly PierFileTreeMove[];
  performMove: (from: string, to: string) => Promise<void>;
  rollback: (target: {
    removedPaths: readonly string[];
    restoredPaths: readonly string[];
  }) => void;
}): Promise<void> {
  const moves = input.moves.filter((move) => move.from !== move.to);
  if (moves.length === 0) {
    return;
  }
  let confirmed = false;
  try {
    confirmed = await input.confirm(moves);
  } catch {
    confirmed = false;
  }
  if (!confirmed) {
    input.rollback({
      removedPaths: moves.map((move) => move.to),
      restoredPaths: moves.map((move) => move.from),
    });
    return;
  }
  for (const move of moves) {
    await input.performMove(move.from, move.to);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run tests/unit/renderer/files/tree/move-confirm.test.ts`
Expected: PASS（8 个用例）。

- [ ] **Step 5: 四语言 locale 补键**

在 4 个 locale 文件的 `messages` 对象中，把下列 6 个键插到 `"filePanel.tree.moved"` **之前**（ASCII 排序）。

`src/plugins/builtin/files/locales/en.json`：

```json
    "filePanel.tree.moveConfirm.body": "Move \"{{name}}\" into \"{{target}}\"?",
    "filePanel.tree.moveConfirm.bodyMulti": "Move {{count}} items into \"{{target}}\"?",
    "filePanel.tree.moveConfirm.cancelLabel": "Cancel",
    "filePanel.tree.moveConfirm.confirmLabel": "Move",
    "filePanel.tree.moveConfirm.rootTarget": "project root",
    "filePanel.tree.moveConfirm.title": "Move",
```

`src/plugins/builtin/files/locales/zh-CN.json`：

```json
    "filePanel.tree.moveConfirm.body": "将「{{name}}」移动到「{{target}}」？",
    "filePanel.tree.moveConfirm.bodyMulti": "将 {{count}} 项移动到「{{target}}」？",
    "filePanel.tree.moveConfirm.cancelLabel": "取消",
    "filePanel.tree.moveConfirm.confirmLabel": "移动",
    "filePanel.tree.moveConfirm.rootTarget": "项目根目录",
    "filePanel.tree.moveConfirm.title": "移动",
```

`src/plugins/builtin/files/locales/ja.json`：

```json
    "filePanel.tree.moveConfirm.body": "「{{name}}」を「{{target}}」に移動しますか？",
    "filePanel.tree.moveConfirm.bodyMulti": "{{count}} 個の項目を「{{target}}」に移動しますか？",
    "filePanel.tree.moveConfirm.cancelLabel": "キャンセル",
    "filePanel.tree.moveConfirm.confirmLabel": "移動",
    "filePanel.tree.moveConfirm.rootTarget": "プロジェクトルート",
    "filePanel.tree.moveConfirm.title": "移動",
```

`src/plugins/builtin/files/locales/ko.json`：

```json
    "filePanel.tree.moveConfirm.body": "\"{{name}}\"을(를) \"{{target}}\"(으)로 이동하시겠습니까?",
    "filePanel.tree.moveConfirm.bodyMulti": "{{count}}개 항목을 \"{{target}}\"(으)로 이동하시겠습니까?",
    "filePanel.tree.moveConfirm.cancelLabel": "취소",
    "filePanel.tree.moveConfirm.confirmLabel": "이동",
    "filePanel.tree.moveConfirm.rootTarget": "프로젝트 루트",
    "filePanel.tree.moveConfirm.title": "이동",
```

JSON 语法校验：`for f in en zh-CN ja ko; do jq empty src/plugins/builtin/files/locales/$f.json || echo "$f INVALID"; done`（无输出即合法）。

- [ ] **Step 6: 回归 + 类型检查**

Run: `pnpm exec vitest run tests/unit/renderer/files/tree/ && pnpm typecheck`
Expected: 全部 PASS；typecheck 无错误。

---

### Task 2: sidebar.tsx 接线

**Files:**
- Modify: `src/plugins/builtin/files/renderer/tree/sidebar.tsx`（import 区 + `handleMovePaths`，现 483 行）

**Interfaces:**
- Consumes: Task 1 的 `confirmTreeMoves` / `handleTreeDragMoves`；既有 `rollbackFilesTreeModelMove({ instanceId, root, removedPaths, restoredPaths })`（`./registry.ts`，sidebar 已 import）；组件内已有 `context` / `t` / `instanceId` / `root` / `performMove`。
- Produces: `handleMovePaths`（`(moves: readonly PierFileTreeMove[]) => void`，传给 `PierFileTree` 的 `onMovePaths`，签名不变）。

- [ ] **Step 1: 加 import**

`sidebar.tsx` 的相对 import 区（`./context-menu.ts` 之前，字母序第一）加：

```ts
import { confirmTreeMoves, handleTreeDragMoves } from "./action-utils.ts";
```

- [ ] **Step 2: 替换 handleMovePaths**

现状（约 232–247 行）：

```ts
  const handleMovePaths = useCallback(
    (moves: readonly PierFileTreeMove[]) => {
      (async () => {
        for (const move of moves) {
          if (move.from === move.to) {
            continue;
          }
          await performMove(move.from, move.to);
        }
      })().catch(() => undefined);
    },
    [performMove]
  );
```

替换为：

```ts
  const handleMovePaths = useCallback(
    (moves: readonly PierFileTreeMove[]) => {
      handleTreeDragMoves({
        confirm: (validMoves) =>
          confirmTreeMoves({ context, moves: validMoves, t }),
        moves,
        performMove: (from, to) => performMove(from, to),
        rollback: ({ removedPaths, restoredPaths }) => {
          rollbackFilesTreeModelMove({
            instanceId,
            removedPaths,
            restoredPaths,
            root,
          });
        },
      }).catch(() => undefined);
    },
    [context, instanceId, performMove, root, t]
  );
```

- [ ] **Step 3: 回归 + 类型检查**

Run: `pnpm exec vitest run tests/unit/renderer/files/tree/ && pnpm typecheck`
Expected: 全部 PASS；typecheck 无错误。

---

### Task 3: 收口验证

**Files:** 无（只跑检查）

- [ ] **Step 1: 受影响测试面全跑**

Run: `pnpm exec vitest run tests/unit/renderer/files/ tests/unit/plugins/`
Expected: 全部 PASS（含 files 插件 locale/文案治理类测试，若存在）。

- [ ] **Step 2: lint + format**

Run:

```bash
pnpm exec biome check \
  src/plugins/builtin/files/renderer/tree/action-utils.ts \
  src/plugins/builtin/files/renderer/tree/sidebar.tsx \
  src/plugins/builtin/files/locales/en.json \
  src/plugins/builtin/files/locales/zh-CN.json \
  src/plugins/builtin/files/locales/ja.json \
  src/plugins/builtin/files/locales/ko.json \
  tests/unit/renderer/files/tree/move-confirm.test.ts
```

Expected: 无错误。若仅 import 排序/格式问题：`pnpm exec biome check --write <同一文件列表>` 后重跑。

- [ ] **Step 3: typecheck 终验**

Run: `pnpm typecheck`
Expected: 无错误。

- [ ] **Step 4: 手动 smoke（真实窗口，执行环境无法起 Electron 时交给用户）**

1. `pnpm dev` 打开一个项目，Files 侧栏拖一个文件到某个目录。
2. 弹确认（标题「移动」，正文显示文件名与目标目录）→ 点「取消」/按 Esc：文件保持原位，磁盘无变更，树行回到原位置。
3. 再拖一次 → 点「移动」：文件真实移动，toast「Moved …」+ Undo 仍出现。
4. 多选两个文件拖到目录：只弹一次确认，正文显示「将 2 项移动到「目录」？」；取消后两者都在原位。

---

## Self-Review 记录

- **Spec 覆盖**：确认弹窗（Task 1 Step 3 `confirmTreeMoves`）、取消/异常回滚（Task 1 `handleTreeDragMoves` + Task 2 接线 `rollbackFilesTreeModelMove`）、多选一次确认（`bodyMulti` + 测试）、i18n 四语言（Task 1 Step 5）、测试与验证（Task 1–3）。spec「明确不动」项（rename / cut-paste / toast / 上游库）在计划中无对应改动，符合。
- **类型一致**：`confirmTreeMoves` / `handleTreeDragMoves` 签名在 Task 1 定义与 Task 2 消费一致；`rollback` 目标键 `removedPaths` / `restoredPaths` 与 `registry.ts` 的 `rollbackFilesTreeModelMove` 参数一致。
- **占位符**：无 TBD/TODO；所有代码块为完整可复制内容。
