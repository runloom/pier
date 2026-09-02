# Canvas 画板视口记忆金标准

日期：2026-09-01  
状态：现行权威（files 预览 `WorldStage` 画板视口）  
范围：离开再回来、热更新、切源码时，画板相机意图与落盘载荷。  
不包含：flow / `DocsShell` 阅读滚动；`ZoomPanWorldStage` / `HtmlWorldCanvas` 全屏（无画板路径身份；files 预览禁止包它，见双模式 §3.4）。

运行时相机仍是 [`2026-08-26-canvas-dual-stage-and-ui-expansion-design.md`](2026-08-26-canvas-dual-stage-and-ui-expansion-design.md) §3.4 的 `{ x, y, scale }`（`screen = world × scale + (x,y)`）。本文只锁**意图所有权**与**持久化真源**。

## 一句话终态

画板预览任意时刻只有一个合法相机意图：**用户的自由视口永远优先**；未动手则为适应窗口并跟随尺寸；离开再回来看到的是**同一块世界内容**（视口中心对准的世界点 + 缩放）；热更新与切源码不得抢视口。

## 意图

| 意图 | 何时 | 视口 / 包络变化 | 落盘 |
|------|------|-----------------|------|
| `fitFollow` | 无记忆、上次适应、或用户点适应 / 双击切回 fit | 重算 `fitCamera`（contain、居中） | `{ v: 1, mode: "fit" }` |
| `freeLookAt` | 用户平移、缩放、或离开适应 | **禁止**再自动 fit。改窗口只改 translate，使原世界中心仍在视口中心 | `{ v: 1, mode: "free", scale, worldX, worldY }` |

「不再打扰」= 不重新适应，不是钉死屏幕平移。

世界点 = 写入时视口中心（`clientWidth/2, clientHeight/2`），**不扣**底栏缩放条 chrome。数学只出自 `canvas-math.ts` 的 `worldPointAtViewportCenter` / `cameraLookingAtWorld`。

## 身份与落盘

- 键：`(projectRoot, canvasPath)`，前缀 `pier.files.canvas.worldCamera:`。同文件多标签共享。
- **禁止 nonce** 进入 `resetKey` 或存储键（热更新不得打回适应窗口）。
- **禁止 panelId**（切标签不应变成另一份记忆）。
- renderer `localStorage`，与 Markdown 滚动 / 表格列宽同族。**不进 userData**（那是宿主布局 / 信任授予，不是预览阅读姿态）。配额失败静默降级。
- 未发版旧 `{ mode, x, y, scale }` **不迁移**；解析失败视为无记忆 → `fitFollow`。
- 禁止逐帧写盘：trailing 250ms + 切路径 / 卸载 flush。`camera == null` 或非 world 不写。
- 多窗口：不监听 `storage` 互抢画面。各窗独立看；后写覆盖，供下次打开用。
- 热更新 / 包络变大：不按内容哈希作废视口；只 `softClampCamera` 防甩丢。

## 禁止

1. 把屏幕 `x/y` 当持久化真源（换面板宽度会看错地方）。
2. 用内容哈希作废视口（HMR 会误伤）。
3. `storage` 事件跨窗同步相机。
4. 记忆进 `.canvas.tsx` 或 userData。
5. `free` 窗口变化时自动重新 fit。
6. 为全屏 `HtmlWorldCanvas` 再做一套路径记忆。
7. files 预览目录自写 `fitCamera` / `clampZoom` / `cameraLookingAtWorld`（必须消费 `@pier/ui` 共享数学）。

## 否决记录

曾考虑落盘 CSS `translate + scale`、按正文哈希失效、以及 `storage` 跨窗同步。否决原因见上表：换面板宽度、live-module 热更新、正在看的画面被另一窗抢走。**禁止复活这些路径。**

## 检查点

- `tests/unit/plugins/files/canvas-world-camera-memory-governance.test.ts`
- `tests/unit/ui/canvas-math.test.ts`（look-at 往返 / 换视口尺寸）
- `tests/unit/ui/world-camera-recall.test.ts`
- `tests/unit/plugins/files/canvas-camera-memory.test.ts`
- `tests/unit/renderer/live-modules/canvas-stage-governance.test.ts`（`resetKey: cameraMemoryKey`，禁止 nonce）
