# 面板撕窗金标准

日期：2026-09-01
状态：现行权威（拖出成新窗口的视觉交接）
范围：把面板 tab 拖出所有 Pier 窗口、松手变成新窗口。
不包含：拖入另一扇已有 Pier 窗口的落点 overlay（见 panel-transfer overlay-preview）、菜单「移到新窗口」（无 HTML5 ghost，但仍走同一套 show-hold；新建窗在 materialize 时同样 `revealHost`）。

相关：跨窗口 claim 仍是 Path B（`finishDrag` → `createForTransfer`）；Dockview sticky overlay 由 `dockview-core` document-`dragleave` patch 清理。

---

## 一句话终态

撕窗时源窗口的 tab **不得弹回条上再变成新窗口**：拖出视口即从条上拿走；松手后新窗原生壳立刻出现在光标处并成为前台，中间没有「条归位」这一帧，也不再空等 renderer 启动才亮窗。

---

## 原则

1. **HTML5 ghost 只管拖的过程。** `dragend` 后浏览器会立刻拆掉拖拽幽灵，无法把它变成新窗口。交接必须在松手前把源 tab 藏掉。
2. **在途隐藏 ≠ 事务提交。** 藏 tab 是视觉；真正 `removePanel` 仍在 `releaseSource`。取消 / Escape / 同窗松手必须把 tab 放回条上。
3. **藏 tab 必须挺过 Dockview 还原。** 只给 `.dv-tab` 打 data 属性不够：`dragend` 常会重建节点。用 `html[data-pier-panel-transfer-in-transit]` + `:has([data-panel-tab-id])` 的注入样式，并在 capture-phase `dragend` / `onWillDrop` 同步 `hide`（不要只等 overlay 轮询）。
4. **松手立刻亮原生壳。** `createForTransfer` 仍 `show:false` / 透明启动；claim 一旦有窗口就 `revealHost`（opacity 1 + show + focus），**不等** `waitForTargetWorkspaceReady`。空壳比「回落后再干等」好。面板就绪后 `runtime-moved` 的 `releaseRendererShow` 是 no-op。
5. **光标在外时预创建。** overlay `outside` 即 `ensure` 隐藏窗口并开始 boot；`source` / `target` 则 `discard`。mouseup 复用这扇窗。分类必须忽略这些 window id，避免命中自己。
6. **拖入已有窗口不抢焦点。** 光标已经在那扇窗上。只有 **新建窗口** 才 `focus` / `revealHost`（撕窗成为前台）。
7. **禁止用假 overlay / 克隆 tab 冒充撕窗。** 源 tab 用 Dockview 自己的 `.dv-tab` 隐藏；新窗是真 `BaseWindow`。

---

## 时序

| 时刻 | 源窗口 | 新窗口 |
|------|--------|--------|
| 拖在源窗内 | Dockview HTML5 overlay + ghost | — |
| 光标离开所有 Pier 窗 | overlay 清除；源 `.dv-tab` `display:none` | 预创建（仍 hide / opacity 0，renderer 在 boot） |
| 松手 `dragend` | tab 保持隐藏（claim hold，忽略 overlay `clear`；html CSS 挡住 Dockview 重建的 tab） | `revealHost`：原生壳立刻出现在光标处 |
| `runtime-moved` | tab 仍隐藏 | 面板已在已亮的窗里；`releaseRendererShow` 收尾 |
| `releaseSource` | `removePanel` | 已可见 |
| 取消 / 同窗松手 | tab 放回条上 | 销毁未提交窗 |

---

## 检查点

- 源 tab：`src/renderer/components/workspace/transfer/tear-off.ts` + `.dv-tab[data-pier-panel-transfer-in-transit]` + html 级注入样式
- 松手藏 tab：`dnd.ts` `onDragEnd` / `onWillDrop` + `isDragReleaseOutsideThisWindow`
- 预创建 + 立刻亮窗：`src/main/services/panel-transfer/speculative-window.ts` `ensure` / `revealHost`
- 面板就绪后的二次亮窗：`src/main/services/panel-transfer/commit.ts` `rollForwardAfterRuntimeMoved`
- 测试：`tests/unit/renderer/workspace/panel-transfer-tear-off.test.ts`、`tests/unit/renderer/workspace/panel-tear-off-governance.test.ts`、`tests/unit/main/panel/transfer-speculative-window.test.ts`、`tests/unit/main/panel/transfer-service.test.ts`（outside 撕窗 revealHost）
