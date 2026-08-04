# Panel 在新窗口打开 / 复制 / 跨窗移动设计

> 日期: 2026-08-04  
> 状态: 已批准（P0 + P1 已落地）  
> 背景: 跨窗拖拽（`panelTransfer` + `finishDrag` 窗外松手）已可用，笔记本触控板拖出新窗体验差；需要菜单/命令入口，并补齐 files 的 Copy 与「到其他窗口」。

## 1. 问题与目标

| 用户目标 | 现状 | 目标态 |
|----------|------|--------|
| 把当前 panel 在新窗口打开 | 只能拖 tab 出窗外 | Tab 右键 + 命令面板 **一键 Move** |
| 文件再开一份到新窗 | 无 | files 支持 **Copy into New Window** |
| 文件移到 / 复制到已有窗口 | 只能拖到目标窗 | files 支持 **Move/Copy into Window…** 子菜单 |

非目标（本设计明确不做）：

- 拖拽手势表达 Copy（拖拽恒为 Move，避免触控板歧义）
- Terminal / workbench / welcome 的 Copy（会话/布局语义另议）
- Editor Group 整组 Move/Copy（VS Code group 级命令，P2+）
- Always-on-top 浮窗、多监视器吸附规则变更

业界对齐（VS Code / Cursor）：

- **Move into New Window** / **Copy into New Window**（Tab 右键 + 命令）
- 多窗时 **Move/Copy into Window…**
- 拖出桌面空白 ≈ Move into New Window（Pier 已有，保留）

## 2. 产品矩阵

| Action ID | 中文 | English | 适用范围 | 入口 |
|-----------|------|---------|----------|------|
| `pier.panel.moveToNewWindow` | 移动为新窗口打开 | Move into New Window | 全部 **movable** panel | `dockview-tab`、`command-palette` |
| `pier.panel.moveToWindow` | 移动到其他窗口 | Move to Another Window | 全部 **movable**；无其它窗时 alert | Tab 右键 / 命令面板 → **命令面板 quick pick** 选目标窗 |
| `pier.panel.copyToNewWindow` | 复制到新窗口 | Copy into New Window | **仅 files** | 同上 |
| `pier.panel.copyToWindow` | 复制到其他窗口 | Copy to Another Window | **仅 files**；无其它窗时 alert | Tab 右键 / 命令面板 → **命令面板 quick pick** 选目标窗 |

### 2.1 菜单形态

`dockview-tab` 右键，放在拆分/聚焦之后、关闭类之前（group 建议 `4_window`）：

```
…
拆分 →
聚焦 →
────────
在新窗口打开
复制到新窗口              ← menuHidden 当非 files
移动到窗口 →              ← menuHidden 当非 files 或仅 1 窗
  {窗口标签 1}
  {窗口标签 2}
复制到窗口 →              ← 同上
────────
关闭面板
…
```

命令面板：四个命令均可搜中文/英文 title；「到窗口」在仅一窗时 `enabled=false` 或 `menuHidden` 等价隐藏（命令仍可注册，enabled 看窗数）。

默认 **不绑快捷键**（与 VS Code 主路径一致；避免 chord 体系未齐时占位）。

### 2.2 窗口列表标签

`WindowInfo` 当前只有 `id / recordId / focused / lastFocusedAt`，无 title。v1 标签策略：

1. 优先：该窗 **active panel** 的 `display.short` 或 panel title（经现有 `panel.changed` / descriptor 镜像，若 renderer 已有跨窗 panel 列表则复用；否则 main 在 `window.list` 扩展可选 `title?: string`）
2. 次选：该窗任一 panel 的 `context.projectRootPath` basename
3. 回退：`窗口 {n}` / `Window {n}`（按 `lastFocusedAt` 降序编号，排除当前窗）

P0 可先用回退标签，P1 再 enrich `WindowInfo.title`（推荐：main 在 list 时读各窗 focused webContents 的 document title 或 layout 摘要，单一来源）。

### 2.3 可见性 / enabled

| 条件 | 行为 |
|------|------|
| `!isPanelTransferMovable(component)` | 隐藏 Move to New Window |
| component 不是 files file panel | 隐藏全部 Copy 与「到窗口」 |
| 传输中 / offer 未 accepted | enabled=false |
| 目标窗不存在 / 已关 | 命令失败 → `showAppAlert` |
| unsupported 面板 | 与拖拽一致：不提供菜单项 |

Files 组件 id 以插件注册为准（现网 `pier.files.filePanel`）；门控写 `isFilesPanelComponent(id)` 单测锁定，禁止散落字符串。

## 3. 语义

### 3.1 Move（所有 movable）

- 源窗：commit 后 **移除** 源 tab（现有 `releaseSource` → `api.removePanel`）
- 目标：新 panel **复用源 `panelId`**（与现网 drag move 一致，终端 lifecycle 绑定依赖同 id）
- 新窗 placement：`{ kind: "root" }`
- 已有窗 placement：v1 固定 **active group 末尾 tab**  
  `{ kind: "tab", groupId: activeGroup.id, index: activeGroup.panels.length }`；无 group 时 `{ kind: "root" }`
- 源窗若因此无 panel：现有 `closeAfterTransfer` 可关空窗（保持）
- 成功：自然 UI（新窗出现 / 源 tab 消失），**不 toast**
- 失败：`showAppAlert({ title: t("…Failed"), body: message })`

### 3.2 Copy（仅 files）

- 源 tab **保留**，不调用会 `removePanel` 的 `releaseSource` 路径
- 目标 **新 `panelId`**（uuid），禁止与源同 id（否则同窗/跨窗 layout 冲突）
- Document / draft：
  - **Clean disk**：目标新 `documentId` + 同 path/root（对齐现网 move 的 `allocateTargetSource`）；各自 buffer，打开即读盘
  - **Dirty disk / untitled**：现网 `prepareSource` 已把 draft **clone** 到 staging 并改写 target document id；Copy **复用该 clone 路径**，但 **禁止** `releaseSource` 里 `removeFilesDraftRecord(originalDraftKey)`（源 draft 必须留下）
- 两边 dirty 后独立：Copy 后不再共享 draft key（与同窗「再开一份」多 documentId 模型一致）
- Terminal / params-only 面板：Copy **拒绝**（offer `accepted: false` 或命令 enabled=false）

### 3.3 与拖拽关系

| 路径 | mode | 触发 |
|------|------|------|
| HTML5 drop / finishDrag | **move only** | 保持现状；offer 不写 mode 时默认 `move` |
| 菜单 / 命令 | `move` \| `copy` | 新 **意图式 claim** API（见 §4） |

禁止为菜单去模拟鼠标拖出。

## 4. 契约与主流程 diff

### 4.1 Offer 增加 mode

`src/shared/contracts/panel-transfer.ts`：

```ts
// movable 分支（unsupported 不变）
{
  version: 1,
  transferId: uuid,
  capability: "movable",
  mode: z.enum(["move", "copy"]).default("move"), // 或 optional → 读时默认 move
  panel: movablePanelSchema,
}
```

- 拖拽 offer：继续只发 `capability: "movable"`（默认 move）
- Copy offer：`mode: "copy"`；main 若 component 非 copyable → `accepted: false`，code 语义可用现有 `not_supported`

Journal `PanelTransferJournalRecord` 随 offer 持久化 mode（恢复路径必须知道是否该 release 源）。

### 4.2 新 Pier 命令：意图式执行

不复用 `drop`（drop 要求 **目标窗** caller）也不复用 `finishDrag`（依赖光标/bounds）。源窗发起：

```ts
// panelTransfer.relocate
{
  type: "panelTransfer.relocate",
  transferId: uuid,
  target:
    | { kind: "new-window" }
    | { kind: "window"; windowId: string }, // runtime BrowserWindow id
  placement?: PanelTransferPlacement, // 省略时：new-window → root；window → 目标解析
}
```

Preload：`window.pier.panelTransfer.relocate(...)`。

主流程：

```
source: build offer(panel snapshot) + offer()
source: relocate({ transferId, target })
main:
  validate live offer + source caller
  if mode=copy && !copyable(component) → fail not_supported
  if target.new-window:
    createForTransfer(bounds near source) → internal target
    placement = root
  if target.window:
    resolve windowId → managed target (≠ source)
    placement = await resolveDefaultPlacement(target) // §3.1
  tryClaim(live, target, placement)  // 复用现有事务
```

`resolveDefaultPlacement`：对 managed 目标发轻量 renderer 命令（可新建 `panelTransfer.resolveDefaultPlacement` 或复用 probe + 本地 active group）；失败 fallback `root`。

### 4.3 事务分支（copy）

`transaction.ts` / `commit.ts`：

| 步骤 | move | copy |
|------|------|------|
| `targetPanelId` | `= source panelId` | **新 uuid**（journal 写入） |
| terminal stage/commit | 允许 | **禁止**（copyable 门控已挡；防御性再 assert runtime ≠ terminal） |
| drafts stage/commit | 有则执行 | 有则执行（clone） |
| `releaseSource` | 执行 | **跳过**（phase 仍可记 `source-durable` 空操作，或 copy 专用 path 直接 finalize source 不删 tab） |
| `closeAfterTransfer` | 可关空源窗 | 源仍有 panel → no-op |
| 成功结果 | `{ ok, targetPanelId }` | 同，target 为新 id |

推荐实现：`rollForwardAfterRuntimeMoved` 读 `record.offer.mode`：

```ts
if (mode === "move") {
  await releaseSource(...)
} else {
  // copy: 仅 source finalize(commit) 解冻 / 清 bookkeeping，不 removePanel
  await finalize(source, commit) // adapter finalize 不得删源 draft
}
```

Files `releaseSource` 仅在 move 路径调用；copy 的 `finalize(source)` 只 `takeBookkeeping` / resume mutations，**不得** `removeFilesDraftRecord(original)`。

### 4.4 Copyable 注册

`adapters.ts` / plugin registration：

```ts
isPanelTransferCopyable(component): boolean
// v1: 仅 files file panel 组件 id 返回 true
// 未来: registration.copyable === true
```

`PanelTransferRegistration` 可选扩展（P1 可先硬编码 files id，避免无谓 API 膨胀）：

```ts
| { kind: "custom"; copyable?: boolean; ... }
```

### 4.5 prepareSource 与 mode

现网 files `prepareSource` **已** `allocateTargetSource` + staging draft clone，对 move/copy 内容侧 **同构**。差异只在 commit 是否拆源 tab/源 draft。

可选：`prepareSource` 输入增加 `mode` 供日志与未来差异化；**v1 不强制**，靠事务跳过 release 即可。

注意：move 时源 document 随 panel 移除；copy 时源 panel 仍挂着同一 `sourceDocumentId`，bookkeeping 的 `sourceDocumentId` / `originalDraftKey` 仅用于 move 的 draft 回收——copy finalize 必须 ignore 删除。

## 5. Renderer 接线

### 5.1 共享 helper

`src/renderer/components/workspace/transfer/relocate.ts`（名可调整）：

```ts
async function relocateActiveOrSourcePanel(input: {
  mode: "move" | "copy";
  panelId: string;
  target: { kind: "new-window" } | { kind: "window"; windowId: string };
}): Promise<void>
```

步骤：

1. 读 dockview panel → component / title / params（与 dnd freeze 同款 `mergeDragStartPanelParams` 可省略；菜单路径无 mid-drag 丢参问题，直接 live params）
2. `crypto.randomUUID()` 作 transferId
3. `panelTransfer.offer({ version:1, transferId, capability:"movable", mode, panel })`
4. 若 `!accepted` → alert not supported
5. `panelTransfer.relocate({ transferId, target })`
6. 若 `!result.ok` → `showAppAlert`；ok 则依赖自然 UI

调用方从 `ActionInvocation.sourcePanelId` 取 tab 右键目标；命令面板无 source 时用 `api.activePanel`。

### 5.2 Actions

新建 `panel-window-contributions.ts`（或并入 `panel-layout-contributions.ts` 的 `4_window` group）：

- surfaces: `["dockview-tab", "command-palette"]`（**不**挂 terminal/content，避免终端内容区噪音；Move to New Window 若希望终端内也能触发，可额外加 `terminal/content`——建议 P0 只 tab + palette）
- `menuHiddenWhen` / `enabled` 用 when 表达式 + 运行时 `isFiles…` / `listWindows`
- 「到窗口」子菜单：动态子项有两种实现

**目标窗选择统一走命令面板 quick pick**（与 SSH host / Agent Index 同壳）：

- 右键与命令面板入口共用 `pickOtherWindowId()` → `useCommandPaletteController.openQuickPick`
- 0 个其它窗 → `showAppAlert` 提示先开窗
- 1+ 其它窗 → 始终打开 quick pick（可搜索）
- 不使用 content dialog / 原生动态 submenu

### 5.3 i18n

`context-menu` / `commandPalette`（中英同步）：

```
contextMenu.action.moveToNewWindow
contextMenu.action.copyToNewWindow
contextMenu.action.moveToWindow
contextMenu.action.copyToWindow
workspace.panelTransfer.moveToNewWindowFailed
workspace.panelTransfer.copyToNewWindowFailed
workspace.panelTransfer.moveToWindowFailed
workspace.panelTransfer.copyToWindowFailed
workspace.panelTransfer.pickWindowTitle   // 选择目标窗口
workspace.panelTransfer.noOtherWindows    // 没有其他窗口
workspace.panelTransfer.windowLabel       // 窗口 {n}
```

用户文案禁实现词（transfer、panelId、claim 等）。

### 5.4 贡献点登记

- `src/shared/plugin-core-contribution-ids.ts` 增加 4 个 command id
- 治理/单测：user-copy、panel actions surfaces、files-only 门控

## 6. 分阶段交付

### P0 — 笔记本主路径

1. 契约：`mode` 默认 move；`panelTransfer.relocate` + preload
2. main：relocate → new-window / existing window claim 复用 `tryClaim`
3. `pier.panel.moveToNewWindow`（全部 movable）
4. 单测：offer 默认 mode、relocate 建窗 claim、失败码
5. 组件/e2e：菜单或命令触发 move 到新窗（可复用 cross-window-drag 夹具，免真实拖拽）

### P1 — files 矩阵

1. `copy` 事务分支 + 新 `targetPanelId`
2. files finalize/release 不删源 draft
3. `copyToNewWindow` / `moveToWindow` / `copyToWindow` + 窗口选择器
4. 单测：dirty disk copy 后源仍 dirty 且内容独立；clean disk 双开；untitled copy 新 id
5. e2e：双窗 copy / move 到 sibling

### P2+（非本设计必做）

- `WindowInfo.title` 产品级标签
- Terminal Move into other window
- Lazy 原生「移动到窗口 →」submenu
- Group 级 Move/Copy
- registration 级 `copyable` 推广到其它 multi-instance web panel

## 7. 风险与边界

| 风险 | 处理 |
|------|------|
| Copy 误走 terminal | offer + relocate 双门控；事务 assert |
| Copy 复用 panelId | journal 强制新 uuid；`hasPanelId` 仍检查 |
| Move 中源窗关闭 | 沿用 `settleWindowBeforeClose` / journal 恢复 |
| 目标窗未 ready | 现有 `waitForTargetWorkspaceReady` |
| 插件卸载中 relocate | 现有 `pluginMutation` 串行 |
| 菜单与拖拽并发 | 现网 per-source-window 单 offer；新 relocate 前 cancel 旧 offer |
| 空 files shell（无文档） | 允许 Move/Copy 空壳；prepareSource 已支持 empty-shell |

## 8. 测试计划（摘要）

| 层 | 用例 |
|----|------|
| unit contract | mode default；copy offer schema；relocate schema |
| unit main transfer | relocate new-window move；relocate managed；copy skips releaseSource；copy new targetPanelId |
| unit files | copy dirty 保留 originalDraftKey；move 删除 original |
| unit actions | surfaces、files-only menuHidden、单窗禁用到窗口 |
| component | 命令触发后 offer+relocate mock 调用序 |
| e2e | P0 move 新窗；P1 copy 新窗后源 tab 仍在；move 到 sibling 后源消失 |

## 9. 改动地图（实施索引）

```
shared/contracts/panel-transfer.ts     +mode, +relocate command schema
preload/panel-transfer-api.ts          +relocate
main/services/panel-transfer/
  service.ts                           +relocate
  transaction.ts / commit.ts           mode 分支
  types.ts                             journal/offer mode
renderer/components/workspace/transfer/
  relocate.ts                          意图式 helper（新）
  adapters.ts                          isPanelTransferCopyable
renderer/lib/actions/                  window contributions
renderer/i18n/locales/**               文案
plugins/builtin/files/.../transfer-*   copy finalize 不删源 draft（若需显式 mode）
tests/**                               上表
```

## 10. 决议清单（批准时确认）

1. **Move 新窗 + 其他窗：全 movable**；**Copy 仅 files** — 是  
2. **目标窗统一命令面板 quick pick** — 是  
3. **拖拽永不 Copy** — 是  
4. **Move 到已有窗 placement = active group 末尾 tab / root** — 是  
5. **不绑默认快捷键** — 是  

若批准，按 §6 P0 → P1 实施；本文件为唯一产品+契约真源，实现 PR 描述链到此 spec。
