# 目录树拖拽金标准终态方案

日期：2026-08-27
状态：**产品已确认（2026-08-27）** — 方案 C：鼠标 8px 激活 + 确认前不改树模型。
实现进度：规格已确认，代码未落地。宣称「金标准完成」须 G0–G4 全绿。
范围：Files 侧栏 `PierFileTree` **树内拖拽移动**（起拖、落点、确认、模型提交、布局 overlay 隔离）。
关联：

- 母约 `docs/archive/superpowers/specs/2026-07-02-project-file-tree-design.md`（危险操作用确认；move 成功后才 patch 树）
- 确认 UI `docs/superpowers/specs/2026-08-27-file-tree-drag-move-confirm-design.md`（弹窗文案与 `confirmTreeMoves` 仍有效；**提交时序以本文为准**）

### 文档层级（冲突时）

| 文档 | 角色 | 与本文关系 |
|------|------|------------|
| **本文** | 拖拽移动终态唯一权威：起拖、commit 时序、overlay 隔离、G 门 | 权威 |
| `2026-08-27-file-tree-drag-move-confirm-design.md` | 确认弹窗文案 / `dialogs.confirm` 契约 | 弹窗 UI 仍有效；「模型先行 + 取消回滚」作废 |
| `2026-07-02-project-file-tree-design.md` | 文件树产品母约 | 母约仍有效；拖拽时序以本文为准 |
| `patches/@pierre/trees@1.0.0-beta.5.patch` | 引擎补丁 | 实现须对齐本文；冲突时改 patch 或改本文 |

**实现禁令：** 未对照本文时，禁止再合「只加确认 / 只 rollback / 只收 MIME」充当终态。

---

## 1. 问题

现网（含已合的确认弹窗）仍不是终态：

1. **入口零阈值**：`@pierre/trees` 行按钮 `draggable=true`，鼠标按下后任意位移即 HTML5 `dragstart`。Touch 端反而有 400ms 长按。
2. **模型先行**：`completeDrag()` 先 `store.move` 再 `onDropComplete`。确认出现时行已经跳走；取消靠 `rollbackFilesTreeModelMove`。违反母约「move 成功后才 patch 树」「不能因为树 UI 先完成就允许无保护 move」。
3. **布局误亮**（已单独收闸）：文件树 HTML5 `text/plain` 曾被面板转移 `onUnhandledDragOver` 当成外来 tab。MIME 闸门已收紧；终态要求文件树鼠标拖拽根本不走 HTML5，作为双保险。

对照：VS Code Explorer 有实质位移才起拖，确认发生在资源未改之前；删除路径本仓库已有确认。

---

## 2. 目标与非目标

目标：

- 单击 / 微抖打开文件、展开目录，与拖拽移动严格分开。
- 松手后先确认；**确认前树模型与磁盘都不改**。取消是空操作。
- 确认后才 `files.move`，成功再改树（失败不留幽灵行）。
- 树内拖拽不得点亮 Dockview 布局落点；本窗 tab 分屏与跨窗面板转移不受影响。

非目标：

- 不改 inline rename、剪切粘贴（显式动作）。
- 不做全局 Cmd+Z 文件操作撤销（母约第一版不做；成功 toast + Undo 保留）。
- 不做「不再询问」设置。
- 不把文件拖出到 Finder / 不接收外部文件到树（母约第一版不做 external drag/drop）。
- 不改「松手在文件行 → 目标为该文件父目录」（VS Code 同款；确认文案已写目标目录）。
- 不改 touch 长按 400ms 语义。

---

## 3. 硬约束

| 编号 | 约束 | 原因 |
|------|------|------|
| K1 | 鼠标起拖必须指针位移 ≥ `FILE_TREE_POINTER_DRAG_THRESHOLD_PX`（**8**） | 对症零阈值误触 |
| K2 | 鼠标树内拖拽走 **pointer 会话**（与现有 touch 拖同一套 `startDrag` / `setDragTarget` / `completeDrag`），**禁止**行按钮 `draggable=true` | 避免 HTML5 泄漏到 Dockview；无法在 mousedown 后再编程启动 HTML5 拖 |
| K3 | `commitOnDrop` 默认 `true`（上游兼容）；Pier Files 必须 `false`：`completeDrag` **不得** `store.move` | 确认前树不跳 |
| K4 | 确认 UI 仍走 `confirmTreeMoves`（`intent: "default"`，不传 `size`，无侧标） | 已落地契约，不另起弹窗 |
| K5 | `commitOnDrop: false` 时取消 / 确认异常 **禁止** 调 `rollbackFilesTreeModelMove` | 模型没动，回滚会造幽灵路径 |
| K6 | 磁盘成功后才 `moveFilesTreeEntry` / `performMove` 现有成功路径 | 母约「成功后 patch 树」 |
| K7 | 布局 overlay 仍只认 `application/x-pier-panel-transfer` | 已修闸门保留 |
| K8 | 补丁只加在既有 `patches/@pierre__trees@1.0.0-beta.5.patch`，禁止改 `node_modules` 当交付 | 仓库 patch 纪律 |
| K9 | G0–G4 全绿前不得宣称金标准、不得写 CHANGELOG「拖拽金标准完成」 | 与滚动金标准同一宣称纪律 |

---

## 4. 引擎补丁（`@pierre/trees` 1.0.0-beta.5）

在既有 flatten / 搜索 / 截断补丁上追加。默认行为必须与未配新字段的上游一致。

### 4.1 配置

`FileTreeDragAndDropConfig` 新增（可选）：

```ts
commitOnDrop?: boolean; // 默认 true：completeDrag 仍 store.move（上游兼容）
pointerDragThresholdPx?: number; // 默认 0：保持行 draggable HTML5。>0 时鼠标改 pointer 会话
```

Pier 经 `fileTreeDragAndDropConfig` 传入：

```ts
{
  commitOnDrop: false,
  pointerDragThresholdPx: 8,
  onDropComplete: /* 现有 */
}
```

常量 `FILE_TREE_POINTER_DRAG_THRESHOLD_PX = 8` 放 `packages/ui/src/file/`（Pier 单一来源）；patch 只读 config 数值，不在引擎里写死 8。

### 4.2 鼠标 pointer 会话（`FileTreeView.js`）

当 `pointerDragThresholdPx > 0`：

- 行按钮 **`draggable={false}`**（与 parked 行一致），不挂 `onDragStart` / `onDragEnd`。
- `pointerdown`（`button === 0` 才武装）：记录起点与 `targetPath`。右键 / 中键不武装。
- `pointermove`：位移平方 ≥ 阈值平方 → `controller.startDrag(path)`，挂自定义预览（复用现有 touch 预览 / `shouldUseCustomPointerDragImage` 逻辑），`elementFromPoint` 更新 `setDragTarget`，边缘滚动与 hover 展开沿用现网。
- 未过阈值的 `pointerup`：不 `startDrag`，让随后的 `click` 正常打开 / 选中。
- 已过阈值的 `pointerup`：`syncDropTargetFromPoint` → `completeDrag()`；**吞掉随后 click**（与 touch 拖结束后不触发 click 同款）。
- `pointercancel` / `Escape`：`cancelDrag()`，不提交。
- 搜索打开时 `startDrag` 现网已拒绝，保持。

Touch：仍走现网 `onTouchStart` 长按 400ms + 10px 取消待发；**不**改用 8px 立即起拖。

### 4.3 `completeDrag`（`FileTreeController.js`）

现网：算 drop plan → `store.move` / `batch` → `onDropComplete`。

改为：算 drop plan → **仅当 `commitOnDrop !== false`** 才写 store → 无论是否写 store，都调 `onDropComplete(result)`。`buildDropOperations` 仍过滤 no-op / 自拖入子孙。

`onDropComplete` 的 `FileTreeDropResult`（`draggedPaths` + `target`）足够 Pier 算 `from`/`to`，不依赖模型已移动。

### 4.4 HTML5 残留

`pointerDragThresholdPx > 0` 时不启动 HTML5，因此：

- 不出现 `text/plain` 路径 dragstart。
- 现网 `window dragend → cancelDrag` 对鼠标 pointer 会话无意义；pointerup/cancel 自己收尾。
- `handleTreeDrop` / `handleTreeDragOver` 仅服务仍走 HTML5 的默认配置（阈值 0）。

---

## 5. Pier 接线

1. **`tree-write-options.ts`**：`fileTreeDragAndDropConfig` 加上 `commitOnDrop: false`、`pointerDragThresholdPx: FILE_TREE_POINTER_DRAG_THRESHOLD_PX`。
2. **`tree-types.ts`**：删除「模型层已移动」注释；改为「drop 完成（模型是否已移动取决于引擎 `commitOnDrop`）；Files 为 false，业务方确认后才 fs + 改树」。
3. **`handleTreeDragMoves`**：`commitOnDrop: false` 下取消 / 确认异常 **不 rollback**，只跳过 `performMove`。磁盘失败路径仍由 `performMove` 自己 rollback（那时树可能已被 `moveFilesTreeEntry` 改过，或尚未改——`performMove` 现网是 fs 成功才 `moveFilesTreeEntry`，失败 rollback 的是库先行模型。终态库不先行，**磁盘失败不得再 rollback 一个没发生的模型移动**；最多 `reloadFilesTreeRoot`）。
4. **`sidebar.tsx` `handleMovePaths`**：不再为取消注入 `rollbackFilesTreeModelMove`。`performMove` 成功路径保持 toast + Undo（Undo 仍是反向 `performMove`，合法）。
5. **Git review 树**：不传 `onMovePaths`，拖拽保持关闭。不受影响。

---

## 6. 确认弹窗（继承，不重做）

沿用 `confirmTreeMoves`：

- 单条 / 多条 / 根目录文案与四语言 key 已存在。
- `intent: "default"`，不传 `size`，无侧标。
- 多选一次确认（`onDropComplete` 单 target）。

---

## 7. 验收门（G0–G4）

未全绿只可说「确认弹窗 / overlay 闸门已落地」，**不得**称拖拽金标准完成。

| 门 | 标准 | 证据 |
|----|------|------|
| **G0** | 按下后抖动 < 8px：不起拖、无预览、不弹确认、不亮紫环；松开仍是单击打开 / 选中 | 手工 + 引擎侧位移计算单测（若 patch 可测）或 Pier 治理测试锁阈值常量 = 8 |
| **G1** | 位移 ≥ 8px：仅树内 drop 高亮；Files 面板无 Dockview 紫框 | 手工；配置锁 `draggable` 关闭 + overlay MIME 单测仍绿 |
| **G2** | 松手弹确认时行仍在原位；取消 / Esc：磁盘与树不变，无 rollback 调用 | `handleTreeDragMoves` 单测：取消不调 rollback、不调 performMove |
| **G3** | 确认后才 fs；成功才改树；失败 alert + 必要时 reload，无幽灵行 | `performMove` 现网成功才 `moveFilesTreeEntry`；失败不再误 rollback |
| **G4** | 本窗 tab 分屏 overlay 仍在；跨窗面板转移仍只认专用 MIME；裸 `text/plain` 不 accept | 既有 `panel-transfer.test.ts` |

残留（接受，不挡宣称）：

- `@pierre/trees` 未设阈值时仍是 HTML5（给其他消费者）。
- Touch 长按不是 8px，是另一套激活。
- 成功 toast Undo 不是 Cmd+Z。

---

## 8. 测试与治理

- 更新 `tests/unit/renderer/files/tree/move-confirm.test.ts`：取消 / 确认异常 **不** rollback。
- 保留 `does not accept file-tree text/plain dragover as a panel transfer`。
- 新增治理或配置测试：`fileTreeDragAndDropConfig` 含 `commitOnDrop: false` 与 `pointerDragThresholdPx === 8`。
- 补丁回归：`pnpm.patchedDependencies` 仍指向同一 patch 文件；`FileTreeDragAndDropConfig` 类型含新字段。

验证命令：

- `pnpm exec vitest run tests/unit/renderer/files/tree/ tests/unit/renderer/workspace/panel-transfer.test.ts`
- `pnpm typecheck`
- 手工 G0–G4（`pnpm dev`）

---

## 9. 自审

- 无占位。提交时序与旧确认规格冲突处已写明「以本文为准」。
- 范围单特性：树内拖拽移动，不含全局 undo / 外部 DnD。
- 歧义已钉死：阈值 8、仅左键、touch 不改、取消不 rollback、Git 树不启用拖拽。
