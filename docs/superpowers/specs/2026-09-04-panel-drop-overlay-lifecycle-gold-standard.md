# 面板落点浮层生命周期金标准

日期：2026-09-04
状态：现行权威（拖拽落点预览的寿命，不是撕窗交接）
范围：面板 tab 拖拽期间，源窗 HTML5 绝对落点层与外窗 Path B `showOverlay` 的出现、切换、结束。
不包含：撕窗时源 tab 隐藏 / 新窗 `revealHost`（见面板撕窗金标准）、菜单「移到新窗口」、文件树拖拽。

相关：[`2026-09-01-panel-tear-off-gold-standard.md`](./2026-09-01-panel-tear-off-gold-standard.md)。跨窗口 claim 仍是双通道（HTML5 `drop` + Path B `finishDrag`）；本文件只管落点层何时可以画、何时必须灭。

检查点：`tests/unit/renderer/workspace/panel-drop-overlay-lifecycle-governance.test.ts`、`tests/unit/main/panel/transfer-overlay-preview.test.ts`、`tests/unit/renderer/workspace/panel-transfer-overlay-preview.test.ts`、`tests/unit/renderer/workspace/panel-transfer-attach.test.ts`、`tests/unit/main/panel/transfer-service.test.ts`。

---

## 一句话终态

拖还在，浮层才能在；拖一结束，所有 Pier 窗口的落点层必须在同一拍消失，并且同一 `transferId` 不能被晚到的 Path B preview 或晚到的 `offer()` 再点亮。视觉层（Dockview `showOverlay` / HTML5 绝对层）和输入路由全屏命中区（`panel-transfer-drop-preview`）必须同拍 `idle()`：只拆视觉、不拆命中区，终端会「看得见但点不到」。

---

## 所有权（法律）

1. **寿命主人（单一主人）**：renderer `createPanelTransferOverlayPreviewSession`。状态按 `transferId` 记，不是整窗一个 `closed` 布尔。`end(id)` 在没有 live B 时必须 `idle()`（`liveId === null` 也要拆残留命中区）；只有 `liveId === B` 时 `end(A)` 才跳过。
2. **广播主人**：main overlay preview controller 只在未封账时 `start`；任一结束出口先 `seal(transferId)`，再做 claim / 等 offer。`seal` = 发 `clear` + 该 id 进入 sealed，之后 `start` 同 id 是 no-op。controller 只有 `seal` / `start`，没有未封账的 `stop`。`start(B)` 先 `seal(A)`。tick 见过 `isLeftMouseButtonDown() === true` 后再读到 button-up，必须 `seal`（`finishDrag` 漏掉时的 fail-closed；未 armed 不得因「按钮本来就抬着」误拆，测试与 addon 缺失走这条）。
3. **画笔**：dockview `showOverlay` / HTML5 绝对层。`dockview-core` document-`dragleave` / document-`dragend`（`onDocumentDragEnd`）补丁只做 fail-closed 拆视觉，**不拥有**寿命，也不许在捕获阶段清 Droptarget `_state`（否则同窗 sticky 提交会坏）。拆视觉不等于释放 `registerTerminalFullscreenWebOverlay`。
4. **禁止**：业务代码再手写一套「该不该显示」；不夺 Esc（禁止用智能体 `Esc` 关浮层）。

`source` 只约束**进行中**：源窗交给 HTML5，不要用 Path B `showOverlay` 去抢。`ended` / `seal` 之后源窗也必须 `idle()`。

---

## 状态机

| 状态 | 谁可以画 | 出口 |
|------|----------|------|
| idle | 无 | `begin(id)` / 未封账的 `offer`→`start` / 未封账的 `target` |
| live | 该 `transferId` 的 HTML5 或 `showOverlay` | 见出口表 |
| ended | 无。同 id 的 `source`/`target`/`outside`/`start` 一律忽略 | 仅新 id 的 `begin` / 未封账 `start` 回到 live |

`apply(clear, id)` ≡ `end(id)`。`end(A)` 不得拆掉 `live === B` 的浮层。`begin(B)` 先 `end(A)`。

---

## 出口表（全部先 seal / end）

- HTML5 `drop`（外窗 claim）
- 源窗 `dragend`（microtask 再 `end(id)`，让 dockview 冒泡先用完 `_state`）
- Escape / 系统取消（`isLeftMouseButtonDown()` 仍为 true）
- `cancel` / offer TTL 到期 / `clearOffer`
- `finishDrag` **入口**（先于 `waitForOffer`）
- `tryClaim` 接受 claim
- 窗口销毁 / session `dispose`
- main tick：已 armed 后 button-up（漏 `finishDrag` 时仍发 `clear`）

晚到的 `offer()` 仍可登记并完成撕窗或跨窗 claim，但不得 `start` preview。

---

## 明确不做

- 不改 HTML5 / Path B 双通道 claim，不改 `tryClaim` 单赢家。
- 不改 `dndOverlayMounting: "absolute"`，不撤 document `dragleave` / `dragend` 补丁。
- 不在捕获阶段同步 `clearOverlay`。
- 不给卡住浮层抢终端 `Esc`。
- 不把落点 overlay 写进撕窗金标准原则 / 时序表。
