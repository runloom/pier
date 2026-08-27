# 目录树拖拽金标准终态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 鼠标位移 ≥ 8px 才起拖（pointer 会话、不走 HTML5）；确认前树模型与磁盘都不改；G0–G4 可验收。

**Architecture:** 扩展既有 `patches/@pierre__trees@1.0.0-beta.5.patch`：`commitOnDrop` 与 `pointerDragThresholdPx`。Pier Files 传 `commitOnDrop: false` + 阈值 8。确认仍走 `confirmTreeMoves`；取消不再 rollback。布局 overlay MIME 闸门保持。

**Tech Stack:** `@pierre/trees@1.0.0-beta.5` pnpm patch · TypeScript strict · Vitest 4

## Global Constraints

- 设计依据：`docs/superpowers/specs/2026-08-27-file-tree-dnd-gold-standard-design.md`。
- **全程不执行 `git commit` / `git push` / 创建 PR**（AGENTS.md）；任务收口 = 测试 + typecheck。
- 禁止直接把未进 patch 文件的 `node_modules` 改动当交付；改 dist 后必须更新 `patches/@pierre__trees@1.0.0-beta.5.patch`。
- 补丁默认行为与上游兼容：`commitOnDrop` 缺省 true；`pointerDragThresholdPx` 缺省 0（仍 HTML5）。
- 弹窗：`intent: "default"`，不传 `size`。取消在 `commitOnDrop: false` 下禁止 `rollbackFilesTreeModelMove`。
- Touch 长按 400ms 不改。Git review 树不传 `onMovePaths`。
- 单文件 ≤500 行（`action-utils.ts` / `tree-write-options.ts` / `sidebar.tsx` 均须守住）。
- 不新增 `src/plugins/builtin/files/renderer/tree/` 源文件。

---

## File structure

| 文件 | 职责 |
|------|------|
| `patches/@pierre__trees@1.0.0-beta.5.patch` | 引擎：config 字段、`completeDrag` 跳过 store、鼠标 pointer 起拖 |
| `packages/ui/src/file/tree-write-options.ts` | 阈值常量 + Pier 传入 `commitOnDrop: false` / `pointerDragThresholdPx: 8` |
| `packages/ui/src/file/tree-types.ts` | 修正「模型已移动」注释 |
| `src/plugins/builtin/files/renderer/tree/action-utils.ts` | `handleTreeDragMoves` 取消不 rollback |
| `src/plugins/builtin/files/renderer/tree/sidebar.tsx` | 拖拽 `performMove` 失败不 rollback 引擎模型 |
| `tests/unit/renderer/files/tree/move-confirm.test.ts` | 取消 / 确认异常不 rollback |
| `tests/unit/ui/file-tree-dnd-gold-standard-governance.test.ts` | 锁常量、config 字段、patch hunk |

---

### Task 1: 引擎 `commitOnDrop`（类型 + completeDrag）

**Files:**
- Modify: `packages/ui/node_modules/@pierre/trees/dist/model/publicTypes.d.ts`（`FileTreeDragAndDropConfig`）
- Modify: `packages/ui/node_modules/@pierre/trees/dist/model/FileTreeController.js`（`completeDrag`）
- Modify: `patches/@pierre__trees@1.0.0-beta.5.patch`（改完 dist 后 patch-commit）
- Test: `tests/unit/ui/file-tree-dnd-gold-standard-governance.test.ts`（本 Task 先写 commitOnDrop 断言）

**Interfaces:**
- Consumes: 现有 `completeDrag` 在 `store.move` 之后调 `onDropComplete`。
- Produces: `FileTreeDragAndDropConfig.commitOnDrop?: boolean`（默认 true）；`commitOnDrop === false` 时 `completeDrag` 不算 store，仍调用 `onDropComplete(dropPlan.result)`。

- [ ] **Step 1: 写失败的治理测试**

创建 `tests/unit/ui/file-tree-dnd-gold-standard-governance.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../..");

describe("file-tree DnD gold standard (engine patch)", () => {
  const publicTypes = readFileSync(
    join(
      REPO_ROOT,
      "packages/ui/node_modules/@pierre/trees/dist/model/publicTypes.d.ts"
    ),
    "utf8"
  );
  const controller = readFileSync(
    join(
      REPO_ROOT,
      "packages/ui/node_modules/@pierre/trees/dist/model/FileTreeController.js"
    ),
    "utf8"
  );

  it("declares commitOnDrop on FileTreeDragAndDropConfig", () => {
    expect(publicTypes).toMatch(
      /interface FileTreeDragAndDropConfig \{[\s\S]*commitOnDrop\?: boolean/
    );
  });

  it("skips store.move when commitOnDrop is false", () => {
    expect(controller).toMatch(/commitOnDrop !== false/);
    expect(controller).toMatch(/onDropComplete/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run tests/unit/ui/file-tree-dnd-gold-standard-governance.test.ts`
Expected: FAIL（`commitOnDrop` 不在类型 / controller 中）。

- [ ] **Step 3: 改 publicTypes.d.ts**

在 `interface FileTreeDragAndDropConfig` 中 `onDropComplete?` 之前插入：

```ts
  /**
   * When false, completeDrag does not mutate the path store; onDropComplete
   * still fires. Default true (upstream).
   */
  commitOnDrop?: boolean;
  /**
   * Mouse pointer distance before starting an in-tree drag. 0 (default) keeps
   * native HTML5 `draggable`. Values > 0 disable row `draggable` and use a
   * pointer session (same machinery as touch).
   */
  pointerDragThresholdPx?: number;
```

- [ ] **Step 4: 改 FileTreeController.js `completeDrag`**

把 `completeDrag` 里 `try { if (dropPlan.operations.length === 1) { ... store.move ... } else { ... store.batch ... } }` 包进条件。`try` 整段 store 写入改为：

```js
		try {
			if (this.#dragAndDropConfig?.commitOnDrop !== false) {
				if (dropPlan.operations.length === 1) {
					const singleOperation = dropPlan.operations[0];
					if (singleOperation == null || singleOperation.type !== "move") throw new Error("Expected a single move operation for one-item drops");
					this.#store.move(singleOperation.from, singleOperation.to, { collision: singleOperation.collision });
				} else {
					this.#validateBatchDropOperations(dropPlan.operations);
					this.#store.batch(dropPlan.operations);
				}
			}
		} catch (error) {
			this.#emit();
			this.#dragAndDropConfig?.onDropError?.(error instanceof Error ? error.message : String(error), dropContext);
			return false;
		}
		this.#dragAndDropConfig?.onDropComplete?.(dropPlan.result);
		return true;
```

`commitOnDrop === false` 时不进 store 分支，仍 `onDropComplete`。catch 只包 store 写入（现网已如此）。

- [ ] **Step 5: 跑治理测试**

Run: `pnpm exec vitest run tests/unit/ui/file-tree-dnd-gold-standard-governance.test.ts`
Expected: PASS。

- [ ] **Step 6: 更新 patch 文件**

在仓库根把当前已改的 `@pierre/trees` dist 写回 patch（保留既有 flatten/搜索 hunk）：

```bash
pnpm patch @pierre/trees@1.0.0-beta.5
```

把刚改的 `publicTypes.d.ts` 与 `FileTreeController.js` 拷进命令打印的临时目录（覆盖），然后：

```bash
pnpm patch-commit <pnpm-patch 打印的目录>
```

确认 `patches/@pierre__trees@1.0.0-beta.5.patch` 含 `commitOnDrop` / `pointerDragThresholdPx`。**不要**丢掉旧的 flattenMinDepth / Truncate hunk。

---

### Task 2: 引擎鼠标 pointer 起拖

**Files:**
- Modify: `packages/ui/node_modules/@pierre/trees/dist/render/FileTreeView.js`
- Modify: `patches/@pierre__trees@1.0.0-beta.5.patch`（再次 patch-commit）
- Test: 同一治理文件追加断言

**Interfaces:**
- Consumes: `controller.getDragAndDropConfig()?.pointerDragThresholdPx`；现有 `startDrag` / `setDragTarget` / `completeDrag` / `cancelDrag`；现有 touch 预览 `createDragPreviewElement`、`syncDropTargetFromPoint`、`updateDragPoint`、`clearDragPreview`。
- Produces: `pointerDragThresholdPx > 0` 时行 `draggable` 为 false，鼠标左键位移达阈值后走 pointer 会话；未达阈值的 pointerup 不 startDrag，随后 click 正常。Touch 仍 `onTouchStart` 长按，不走鼠标阈值。

- [ ] **Step 1: 治理测试追加（先红）**

在 `file-tree-dnd-gold-standard-governance.test.ts` 增加：

```ts
  it("disables HTML5 draggable when pointerDragThresholdPx is active", () => {
    const view = readFileSync(
      join(
        REPO_ROOT,
        "packages/ui/node_modules/@pierre/trees/dist/render/FileTreeView.js"
      ),
      "utf8"
    );
    expect(view).toMatch(/pointerDragThresholdPx/);
    expect(view).toMatch(/draggable:\s*dragAndDropEnabled && !isParked && pointerDragThresholdPx <= 0/);
  });
```

Run: `pnpm exec vitest run tests/unit/ui/file-tree-dnd-gold-standard-governance.test.ts`
Expected: 新用例 FAIL。

- [ ] **Step 2: FileTreeView.js 行为（最小完整实现）**

在 `FileTreeView` 内、touch 拖拽函数旁增加鼠标 pointer 会话。要点（必须全部做到）：

1. `const pointerDragThresholdPx = controller.getDragAndDropConfig()?.pointerDragThresholdPx ?? 0;`（随 render 读取；行 props 用当前值）。
2. 行按钮：
   - `draggable: dragAndDropEnabled && !isParked && pointerDragThresholdPx <= 0`
   - `onDragStart` / `onDragEnd` 仅当 `dragAndDropEnabled && !isParked && pointerDragThresholdPx <= 0`
   - 增加 `onPointerDown`：仅 `event.pointerType !== "touch"` 且 `event.button === 0` 且 `pointerDragThresholdPx > 0` 且 `dragAndDropEnabled && !isParked` 时武装。
3. 武装：记录 `{ x, y, path, row }`。`pointermove`（window）：`dx*dx+dy*dy >= threshold*threshold` 时若尚未 `startDrag`，调用与 touch 激活后相同的预览 + `controller.startDrag(path)`（失败则解除武装）。之后 `syncDropTargetFromPoint` + `updateDragPoint`，`preventDefault` 防选区。
4. `pointerup`：若从未 startDrag → 只解除武装（让 click 发生）。若已 startDrag → `syncDropTargetFromPoint` + `completeDrag()` + 清预览，并设 `suppressClickRef` 使紧随的 `onClick` return。
5. `pointercancel` 或 `Escape`：`cancelDrag()` + 清预览，不 complete。
6. 清理：`pointerup/cancel` 必须 remove window listener，避免泄漏。
7. **不要**改 `handleRowTouchStart` 的 400ms / 10px。
8. `window` 上现有 `dragend → cancelDrag` 保留（HTML5 默认路径仍需要）。

`onClick` 现有逻辑开头加：

```js
if (suppressClickRef.current) {
  suppressClickRef.current = false;
  return;
}
```

- [ ] **Step 3: 治理测试转绿 + 再 patch-commit**

Run: `pnpm exec vitest run tests/unit/ui/file-tree-dnd-gold-standard-governance.test.ts`
Expected: PASS。

再次 `pnpm patch` / `patch-commit`，使 `FileTreeView.js` hunk 进入同一 patch 文件。

---

### Task 3: Pier 传入 config + 阈值常量

**Files:**
- Modify: `packages/ui/src/file/tree-write-options.ts`
- Modify: `packages/ui/src/file/tree-types.ts`（`onMovePaths` 注释）
- Test: 治理测试追加读 `tree-write-options.ts`

**Interfaces:**
- Consumes: Task 1–2 的 config 字段（`@pierre/trees` 类型）。
- Produces: `export const FILE_TREE_POINTER_DRAG_THRESHOLD_PX = 8`；`fileTreeDragAndDropConfig` 返回对象含 `commitOnDrop: false`、`pointerDragThresholdPx: FILE_TREE_POINTER_DRAG_THRESHOLD_PX`、现有 `onDropComplete`。

- [ ] **Step 1: 治理测试追加（先红）**

```ts
  it("wires Files tree drag to commitOnDrop false and 8px pointer threshold", () => {
    const source = readFileSync(
      join(REPO_ROOT, "packages/ui/src/file/tree-write-options.ts"),
      "utf8"
    );
    expect(source).toContain("FILE_TREE_POINTER_DRAG_THRESHOLD_PX = 8");
    expect(source).toContain("commitOnDrop: false");
    expect(source).toContain("pointerDragThresholdPx: FILE_TREE_POINTER_DRAG_THRESHOLD_PX");
  });
```

Run 同一治理文件。Expected: FAIL。

- [ ] **Step 2: 改 tree-write-options.ts**

文件顶部常量 + config：

```ts
export const FILE_TREE_POINTER_DRAG_THRESHOLD_PX = 8;

export function fileTreeDragAndDropConfig(
  readRefs: () => FileTreeRefs
): FileTreeDragAndDropConfig {
  return {
    commitOnDrop: false,
    pointerDragThresholdPx: FILE_TREE_POINTER_DRAG_THRESHOLD_PX,
    onDropComplete: (event) => {
      // 保持现有 from/to 映射，一字不改
```

`onDropComplete` 函数体保持现网（`target.kind === "directory"` 等）。

- [ ] **Step 3: 改 tree-types.ts 注释**

`onMovePaths` 现注释「树内拖拽完成(模型层已移动);业务方执行真实 fs move,失败自行刷新回滚。」改为：

```ts
  /** 树内拖拽 drop 完成。Files 配置 commitOnDrop: false，模型尚未移动；业务方确认后才 fs + 改树。 */
```

- [ ] **Step 4: 治理测试转绿**

Run: `pnpm exec vitest run tests/unit/ui/file-tree-dnd-gold-standard-governance.test.ts`
Expected: PASS。

---

### Task 4: 取消不 rollback；拖拽失败不 rollback 引擎模型

**Files:**
- Modify: `src/plugins/builtin/files/renderer/tree/action-utils.ts`（`handleTreeDragMoves` + 注释）
- Modify: `src/plugins/builtin/files/renderer/tree/sidebar.tsx`（`performMove` / `handleMovePaths`）
- Test: `tests/unit/renderer/files/tree/move-confirm.test.ts`

**Interfaces:**
- Consumes: 现有 `handleTreeDragMoves({ confirm, moves, performMove, rollback })`。
- Produces: `rollback` 改为可选。未确认 / 确认抛错时 **不调用** `rollback`。`performMove` 增加 `options?: { silent?: boolean; rollbackModel?: boolean }`，`rollbackModel` 默认 true（rename 仍模型先行）；拖拽传入 `false`。

- [ ] **Step 1: 改失败测试（先改断言再改实现）**

`move-confirm.test.ts` 中：

- `rolls the model back once when the user cancels` → 改名为 `does not move or roll back when the user cancels`，断言 `performMove` 与 `rollback` 都不调用。
- `treats a confirm failure as cancel` → 同样断言 `rollback` **不**调用。

Run: `pnpm exec vitest run tests/unit/renderer/files/tree/move-confirm.test.ts`
Expected: FAIL（现网取消仍调 rollback）。

- [ ] **Step 2: handleTreeDragMoves**

```ts
export async function handleTreeDragMoves(input: {
  confirm: (moves: readonly PierFileTreeMove[]) => Promise<boolean>;
  moves: readonly PierFileTreeMove[];
  performMove: (from: string, to: string) => Promise<void>;
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
    return;
  }
  for (const move of moves) {
    await input.performMove(move.from, move.to);
  }
}
```

删除 `rollback` 参数。更新函数注释：确认前模型未移动，取消为空操作。

`confirmTreeMoves` 注释删掉「库已先行移动」。

- [ ] **Step 3: sidebar.tsx**

`handleMovePaths` 去掉 `rollback` 注入：

```ts
  const handleMovePaths = useCallback(
    (moves: readonly PierFileTreeMove[]) => {
      handleTreeDragMoves({
        confirm: (validMoves) =>
          confirmTreeMoves({ context, moves: validMoves, t }),
        moves,
        performMove: (from, to) =>
          performMove(from, to, { rollbackModel: false }),
      }).catch(() => undefined);
    },
    [context, performMove, t]
  );
```

`performMove` 签名增加 `rollbackModel`（默认 true）。`catch` 里：

```ts
        if (options?.rollbackModel !== false) {
          rollbackFilesTreeModelMove({
            instanceId,
            removedPaths: [to],
            restoredPaths: [from],
            root,
          });
        }
```

rename 的 `performMove(from, to)` 不传该字段，保持默认 rollback。拖拽显式 `false`。失败仍 `alert` + `reloadFilesTreeRoot`。

若 `handleMovePaths` 不再用 `instanceId`/`root`，从依赖数组去掉（`performMove` 闭包已捕获）。

- [ ] **Step 4: 单测转绿**

Run: `pnpm exec vitest run tests/unit/renderer/files/tree/move-confirm.test.ts`
Expected: 8 用例 PASS（取消用例不再期望 rollback）。

---

### Task 5: 收口验证

**Files:** 无（只跑检查）

- [ ] **Step 1: 受影响测试**

Run:

```bash
pnpm exec vitest run \
  tests/unit/ui/file-tree-dnd-gold-standard-governance.test.ts \
  tests/unit/renderer/files/tree/ \
  tests/unit/renderer/workspace/panel-transfer.test.ts
```

Expected: 全绿（含 overlay 裸 `text/plain` 不 accept）。

- [ ] **Step 2: biome + typecheck**

```bash
pnpm exec biome check \
  packages/ui/src/file/tree-write-options.ts \
  packages/ui/src/file/tree-types.ts \
  src/plugins/builtin/files/renderer/tree/action-utils.ts \
  src/plugins/builtin/files/renderer/tree/sidebar.tsx \
  tests/unit/ui/file-tree-dnd-gold-standard-governance.test.ts \
  tests/unit/renderer/files/tree/move-confirm.test.ts
pnpm typecheck
```

Expected: biome clean。typecheck 仅允许 HEAD 预存 `tests/unit/main/app-identity.test.ts(44,7)` TS2345，不得新增错误。

- [ ] **Step 3: 手工 G0–G4（`pnpm dev`，执行环境不能起窗则交给用户）**

1. **G0**：在文件行按下后抖动 < 8px 松开 → 打开/选中，无拖拽预览、无确认、无紫环。
2. **G1**：拖过 8px → 仅树内高亮，Files 面板无 Dockview 紫框。
3. **G2**：松手弹「移动」时行仍在原位；取消 / Esc → 树与磁盘不变。
4. **G3**：确认后文件才移动；toast + Undo 仍在。
5. **G4**：拖 tab 分屏仍有落点。

G0–G4 未在真实窗验证前，不得在 CHANGELOG 写「拖拽金标准完成」。

---

## Self-Review 记录

- Spec K1–K9 / G0–G4：Task 1–2 覆盖引擎；Task 3 接线；Task 4 取消不 rollback；Task 5 验证 + overlay 回归。
- 类型名全程 `commitOnDrop` / `pointerDragThresholdPx` / `FILE_TREE_POINTER_DRAG_THRESHOLD_PX = 8`。
- 无 TBD。无 commit 步骤（仓库规则）。
