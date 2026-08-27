# 目录树拖拽移动确认设计

日期：2026-08-27
状态：确认弹窗 UI 已确认。**提交时序作废**，改以 `docs/superpowers/specs/2026-08-27-file-tree-dnd-gold-standard-design.md` 为准（确认前不改树模型，取消不 rollback）。
关联：`docs/archive/superpowers/specs/2026-07-02-project-file-tree-design.md`（文件树产品母约）

## 背景

当前目录树（`PierFileTree`，引擎 `@pierre/trees`）拖拽移动会出现误触移动文件，根因是双缺：

1. **入口零阈值**：引擎对行按钮直接设 `draggable=true`（`FileTreeView.js`），鼠标端 mousedown 后任何位移即触发原生 dragstart；touch 端反而有 400ms 长按 + 10px 阈值。
2. **结果零确认**：drop 后 `FileTreeController.completeDrag()` **先移动树模型**再同步回调 `onDropComplete`；Pier 侧 `sidebar.tsx` 的 `handleMovePaths` → `performMove` 直接执行真实磁盘 move，全程无确认。唯一兜底是 success toast 上的 Undo 按钮（约 4 秒自动消失）。

与既有约定和业界对照：

- 母约 `2026-07-02-project-file-tree-design.md` L688：「第一版不做全局 undo；危险操作用 confirm」；L1080：「文件写操作必须先补权限和确认路径，不能因为树 UI 先完成就允许无保护 delete/move」。当前 DnD 实现与该两条字面冲突。
- VS Code / Cursor：`explorer.confirmDragAndDrop` 默认 true，拖拽移动必弹确认；JetBrains Project view 拖拽必弹 Move 对话框。
- 本仓库删除路径已有完整确认（`delete-action.ts`：脏文档 `dialogs.choice` 保护 + 干净文档 `dialogs.confirm`）；**移动是树写操作里唯一无确认的**。

## 目标

- 拖拽 drop 后、执行真实磁盘 move 前弹确认；用户取消时不产生任何磁盘变更，并把库已先行移动的树模型回滚。
- 多选拖拽一次确认、一次回滚。

## 非目标

- 不改 inline rename、剪切粘贴 move（显式动作，VS Code 也不确认）。
- 不改成功后的 toast + Undo 反馈（现网行为；确认是动作前关卡，不替代完成后反馈）。
- 不给 `@pierre/trees` 打鼠标拖拽激活阈值 patch（可作为后续增强；不替代确认）。
- 不引入「不再询问」偏好开关（后续按需再加）。

## 设计

### 时序约束（关键）

库的 `completeDrag()` 不可 await：**模型行已在新位置**才轮到 Pier 的 `onDropComplete`。因此确认只能放在业务层 `handleMovePaths`，取消语义 = 回滚模型（与磁盘失败回滚同路径），不是「阻止移动」。

### 改动点

1. **`src/plugins/builtin/files/renderer/tree/action-utils.ts`**（`notifyMoveWithUndo` 已在此，move 反馈单一归属；`tree/` 目录密度已棘轮，不新增文件）
   - 新增 `confirmTreeMoves({ context, t, moves }): Promise<boolean>`：
     - 过滤 `from === to`（防御；库 `buildDropOperations` 已滤 no-op，全 no-op 时 `onDropComplete` 本就不会触发）。
     - 过滤后为空 → 返回 `false`，不弹窗。
     - 单条：body 用 `moveConfirm.body`（`{{name}}` = 源 basename，`{{target}}` = 目标目录显示名）。
     - 多条：body 用 `moveConfirm.bodyMulti`（`{{count}}` + `{{target}}`）。`onDropComplete` 单 drop target 语义保证所有 move 目标目录一致，body 只需一个 target。
     - 目标目录显示名：目标为根时用 `moveConfirm.rootTarget`；否则用目录 basename。
     - 调 `context.dialogs.confirm({ title, body, confirmLabel, cancelLabel, intent: "default" })`。按宿主弹窗规范：固定 `sm`（facade 强制，不传 `size`）、无侧标、`intent` 显式 `"default"`（移动不是破坏性操作）、取消按钮 outline、Esc/点遮罩 = 取消。
   - 新增 `handleTreeDragMoves({ moves, confirm, performMove, rollback }): Promise<void>` 协调器（纯逻辑、可单测）：
     - `moves` 过滤 `from === to` 后为空 → 不动作。
     - `await confirm(moves)` 为 `false` → 调 `rollback({ removedPaths: moves.map(to), restoredPaths: moves.map(from) })` 一次，结束。
     - 为 `true` → 逐条 `await performMove(from, to)`（沿用现有逐条失败回滚 + alert 行为）。
     - `confirm` 抛异常按取消处理：回滚模型、不执行 move、不再向上抛（避免幽灵行残留）。

2. **`src/plugins/builtin/files/renderer/tree/sidebar.tsx`**
   - `handleMovePaths` 改为调用 `handleTreeDragMoves`，注入：
     - `confirm`：`confirmTreeMoves({ context, t, moves })`
     - `performMove`：现有 `performMove`
     - `rollback`：`rollbackFilesTreeModelMove({ instanceId, root, removedPaths, restoredPaths })`（`registry.ts`，与磁盘失败回滚同函数）
   - 保持 `(moves) => void` 签名（库的 `onDropComplete` 同步回调），内部 async 自执行。

3. **i18n**（`src/plugins/builtin/files/locales/{en,zh-CN,ja,ko}.json` 的 `messages` 同步新增）

   | key | en | zh-CN | ja | ko |
   |---|---|---|---|---|
   | `filePanel.tree.moveConfirm.title` | Move | 移动 | 移動 | 이동 |
   | `filePanel.tree.moveConfirm.body` | Move "{{name}}" into "{{target}}"? | 将「{{name}}」移动到「{{target}}」？ | 「{{name}}」を「{{target}}」に移動しますか？ | "{{name}}"을(를) "{{target}}"(으)로 이동하시겠습니까? |
   | `filePanel.tree.moveConfirm.bodyMulti` | Move {{count}} items into "{{target}}"? | 将 {{count}} 项移动到「{{target}}」？ | {{count}} 個の項目を「{{target}}」に移動しますか？ | {{count}}개 항목을 "{{target}}"(으)로 이동하시겠습니까? |
   | `filePanel.tree.moveConfirm.confirmLabel` | Move | 移动 | 移動 | 이동 |
   | `filePanel.tree.moveConfirm.cancelLabel` | Cancel | 取消 | キャンセル | 취소 |
   | `filePanel.tree.moveConfirm.rootTarget` | project root | 项目根目录 | プロジェクトルート | 프로젝트 루트 |

4. **测试** `tests/unit/renderer/files/tree/move-confirm.test.ts`（新文件，沿用该目录 mock context 惯例）
   - 确认通过 → 逐条 `performMove`、不调 `rollback`。
   - 取消 → 不调 `performMove`、`rollback({ removedPaths: [to…], restoredPaths: [from…] })` 恰好一次。
   - 多选 → `confirm` 只调一次，且 body 走 `bodyMulti`（`{{count}}` 正确）。
   - 全部 `from === to` → 不弹窗、不 move、不 rollback。
   - 目标为根 → body 的 `{{target}}` 用 `rootTarget` 文案。

## 验证

- `pnpm exec vitest run tests/unit/renderer/files/tree/`
- `pnpm typecheck`
- smoke：`pnpm dev` 打开项目 → 拖拽一个文件到目录 → 弹确认 → 取消（文件原位、无磁盘变更）→ 再拖 → 确认（移动成功、toast 仍出现）。
