# 终端 Tab 拖拽输入路由与诊断设计

- 日期：2026-08-02
- 状态：架构收敛与诊断已实施并验证；触发问题的根因**尚未定位**，bug 保持打开
- 关联设计：`docs/superpowers/specs/2026-06-29-terminal-input-focus-architecture-design.md`
- 触发问题：拖动同组 tab 到其他位置后回到原终端 panel，终端无法再次聚焦，部分全局快捷键也表现为无响应。

## 1. 目标与完成标准

### 1.1 目标

把 Dockview tab 拖拽期间的终端输入接管，改为由工作台边界根据 Dockview 生命周期管理；同时补齐跨窗口、取消和异常结束分支，并留下可在调试窗口和磁盘日志中复盘的完整轨迹。

### 1.2 完成标准

1. 同窗口 tab 拖拽成功、取消、窗口外释放后，`dockview-tab-drag` 不会残留为 Web 输入所有者。
2. 跨窗口转移中，源窗口的输入接管一定由源窗口的 `dragend` 释放；目标窗口不会误释放不存在的源会话。
3. Dockview 的正常结束信号丢失时，兜底定时器会恢复输入，并记录明确的异常原因，而不是让用户一直失去终端输入。
4. 回到终端 panel 后，`basePanel`、有效键盘目标和 native `firstResponder` 的关系可由终端调试快照直接检查。
5. 快捷键路径可区分：未进入 renderer、被输入框抑制、被 overlay 阻塞、动作不可用、已执行或动作报错。
6. 诊断信息持久化到现有 `userData/diagnostics/app-*.jsonl`，不记录终端内容、粘贴文本、任意原始输入或密钥。

### 1.3 非目标

- 不改变 Ghostty 的命中几何、`EventRouterView` 的坐标算法或原生快捷键转发机制。
- 不用一次性“清空所有 Web owner”的方式恢复焦点；Dialog、命令面板和其他真实浮层的输入所有权必须保留。
- 不把 Dockview 运行时 API 泄漏到 `stores/`、panel kit 或快捷键通用层。
- 不引入远程遥测、账号标识或终端输入采集。

## 2. 现状与根因证据

当前 tab 拖拽输入接管在 `src/renderer/stores/terminal-input-routing-drag.ts` 中由全局 DOM `dragstart` 侦测 `.dv-tab` 后开始。结束却依赖另一个事件集合：`drop`、`dragend`、`blur`、`visibilitychange`、Esc 和五秒定时器。

面板转移则在 `src/renderer/components/workspace/transfer/attach.ts` 中使用 Dockview 的 `onWillDragPanel`、`onDidDrop`、`onWillDrop` 与窗口捕获阶段 `dragend`。两个机制描述的是同一用户动作，却各自维护生命周期，没有共同会话编号或完成语义。

### 2.1 观察到的现象（合成场景）

- 首版新控制器只订阅 `onWillDragPanel + onDidDrop + dragend` 时，Playwright 同窗口重排的真实轨迹只有 `started`：同一 Dockview 实例内的放置走 `onWillDrop → onMove` 而不发 `onDidDrop`，且该 harness 用 CDP 直接派发 drop、不向 renderer 送出可用的 `window dragend`。补上 `onWillDrop` 后该回归通过。
- 人为只触发 `dragstart` 而不触发任何结束事件时，`dockview-tab-drag` 会残留，`basePanel` 虽回到终端，`effectiveKind` 仍是 `web`，直到五秒兜底恢复。
- `requestTerminalFocusIntent()` 有意只清理瞬时 `pier.click`，不清理 durable owner。因此用户“再点回终端”无法纠正任何一个遗留的 durable owner。这是正确的通用浮层语义，但会放大任何生命周期遗漏。
- 在该合成遗留状态下，命令面板快捷键仍可工作，故“快捷键完全无效”不能归因为同一个 owner 残留。

### 2.2 这些观察不能解释触发问题

上述两条泄漏证据都来自合成路径，不是旧实现的真实路径。反过来看旧 `terminal-input-routing-drag.ts`：

- 它在 `beginTabDrag()` 里**无条件**装了五秒兜底定时器，所以泄漏的 `dockview-tab-drag` 最多存活五秒即自愈。用户报的是持续性失焦，量级对不上。
- 它的结束集合里有 `document` 捕获阶段的 `drop`。dockview 7 的 `DragAndDropObserver` 在 `dragover` 里显式 `preventDefault()`（源码注释：needed so that the drop event fires），因此同窗口 tab reorder 一定派发 `drop`，捕获阶段监听器一定先于 dockview 自己的元素级处理执行。旧实现并不依赖 `onDidDrop`，“同实例移动不发 `onDidDrop`”对它不构成缺陷。

结论：**触发问题的根因尚未定位。** 本设计交付的是所有权收敛与可复盘诊断，不宣称修复该 bug。仍需排查的候选包括：sash 拖拽会话（它**没有**兜底定时器，`pointerup` / `pointercancel` / `blur` 全部漏掉即为永久泄漏）、其他 durable Web owner 的释放路径，以及与 owner 无关的原生 `firstResponder` 分支。

因此诊断必须覆盖**全部** Web owner，而不只是 tab 拖拽：sash 会话纳入同一条轨迹（§6.2），并由 owner 滞留看门狗（§6.5）在日志里直接点名卡住的 owner。定位不再依赖用户在卡住的当下手动抓快照。

## 3. 当前结构为什么不足

| 缺口 | 现状 | 后果 |
|---|---|---|
| 生命周期所有权分裂 | 输入路由从 DOM `dragstart` 推断开始，Dockview/转移模块从 Dockview 回调得知开始和结束 | 任一事件被 Dockview、浏览器或跨窗口拖放吞掉时，输入接管无法确定地结束 |
| 无会话关联 | `dockview-tab-drag` 是全局固定 id，没有开始序号、来源、结束原因和耗时 | 快照只能看到“现在仍是 Web”，不能知道哪次拖拽遗留 |
| `blur` 被当作结束 | 跨窗口拖拽会让源窗口失焦，但拖拽并未结束 | 容易提前释放或留下不可解释的时序 |
| 快捷键仅有执行结果 | `use-registry.ts` 没有可查询的决策轨迹 | “没有响应”无法区分事件没到、被抑制、被阻塞还是动作异常 |
| 日志不持久 | 现有焦点 breadcrumb 只存在 renderer 内存 | 用户重启或稍后反馈时无法取得复盘证据 |

## 4. 目标所有权划分

| 层级 | 负责 | 不负责 |
|---|---|---|
| `components/workspace/` | 订阅 Dockview 生命周期、创建/结束 tab 拖拽会话、处理同窗口与跨窗口语义 | 计算原生焦点、执行面板转移协议 |
| `terminal-input-routing-slice.ts` | 根据已命名的输入申请设置 Web overlay 与 Web owner，幂等释放 | 识别 `.dv-tab`、订阅 Dockview 回调、猜测拖拽是否结束 |
| `transfer/` | DataTransfer 标记、跨窗口领取和转移恢复 | 终端输入接管的状态所有权 |
| `terminal-debug/input-routing-trace.ts` | 有界 renderer 轨迹、快照投影、向主进程上报脱敏事件 | 焦点决策本身 |
| `use-registry.ts` | 记录已知快捷键的分派结论，继续执行原有快捷键行为 | 保存任意原始按键或终端输入 |
| main 终端诊断 IPC | 验证 renderer 事件、补充真实窗口身份、用 `createLogger()` 写入既有诊断 JSONL | 信任 renderer 传来的窗口身份或任意文本 |
| native/main 终端路由 | 原生 hit-test、`firstResponder`、原生快捷键 forward | Dockview 生命周期 |

## 5. 数据流与状态机

### 5.1 源窗口 tab 拖拽

```text
Dockview onWillDragPanel(panel)
  → WorkspaceTabDragInputCapture.start(panel.id)
  → 创建 sessionId，记录 started
  → registerTerminalFullscreenWebOverlay(session owner)
  → requestTerminalWebFocus(session owner)

Dockview onWillDrop（同实例移动）
  或 Dockview onDidDrop（外来 payload）
  或 window capture dragend（源窗口终态）
  → WorkspaceTabDragInputCapture.finish(reason)
  → 同一 sessionId 只释放一次
  → 释放 Web focus 与 overlay
  → 记录 ended / reason / elapsedMs / 释放后的 owner 摘要
  → 后续 active panel 变更仍由既有 host 焦点协调处理
```

`onWillDrop` 是同一 Dockview 实例内 tab 移动的成功放置信号；Dockview 随后走内部 `onMove`，不会发出 `onDidDrop`。`onDidDrop` 保留给外来 payload；`window` 捕获阶段 `dragend` 覆盖源窗口的成功、取消、窗口外释放和跨窗口转移。三个信号可能同时或先后到达，状态机以 `sessionId` 幂等处理。

结束原因取决于释放点，测试不得钉死某一个：指针落在 droptarget 上时走原生 `drop` → `onWillDrop`（`dockview-will-drop`）；在 `dndOverlayMounting: "absolute"` 的 sticky overlay 下于 droptarget 之外释放时，Dockview 改在 `dragend` 里提交，而本控制器挂在 `window` 捕获阶段，会先于 Dockview 以 `window-dragend` 结束同一会话。两者都是正常完成。

### 5.2 跨窗口

```text
源窗口 onWillDragPanel → 开始源输入会话
目标窗口 onWillDrop/onDidDrop → 面板转移模块接收并完成目标布局；输入控制器无本地会话时不操作
源窗口 dragend          → 结束源输入会话
```

目标窗口不拥有源窗口的 Web owner，因此不得通过目标 `onDidDrop` 清理源会话。源窗口的捕获阶段 `dragend` 是跨窗口资源释放的权威来源。

### 5.3 取消、窗口外释放与异常

- Esc 作为取消辅助信号结束当前会话；正常情况下浏览器仍会发出 `dragend`，第二次结束仅记录为幂等忽略。
- `window.blur` 只记录观察结果，不再作为终态。跨窗口拖拽期间它不是可靠结束信号。
- `visibilitychange=hidden` 也只用于诊断；卸载时由 disposer 明确结束会话。
- 五秒定时器保留为最后保险：以 `fallback-timeout` 结束、写 `warn` 日志并保留轨迹。它不得成为正常路径。

### 5.4 Sash 拖拽

当前 `terminal-input-routing-drag.ts` 同时承担 tab 与 sash。tab 生命周期迁到工作台边界后，sash 的 pointerdown/pointerup/pointercancel 逻辑独立保留为 renderer 全局机制，不借机重写其行为。

## 6. 诊断设计

### 6.1 统一事件模型

新增共享、可验证的终端输入路由诊断事件。字段只包含枚举、受限字符串、数字和布尔值：

```ts
type TerminalInputRoutingDiagnosticSource = "workspace-tab-drag" | "keybinding";

interface TerminalInputRoutingDiagnosticEvent {
  at: number;
  seq: number;
  source: TerminalInputRoutingDiagnosticSource;
  action: string;
  sessionId?: string;
  panelId?: string;
  reason?: string;
  commandId?: string;
  route?: "web-keydown" | "native-forward";
  elapsedMs?: number;
  webOwnerCount?: number;
}
```

实现时会把 `action`、`reason`、`outcome` 收紧为字面量联合类型，主进程再校验数量、长度和来源。主进程自行补充 `browserWindowId`、稳定窗口 id 和记录时间。

### 6.2 拖拽记录

tab 与 sash 是两个 source（`workspace-tab-drag` / `workspace-sash-drag`），共用会话模型但结束原因各自封闭：tab 是 drop 语义，sash 是 pointer 语义（`pointerup` / `pointercancel` / `window-blur`），schema 不允许交叉。sash 的 `sessionId` 同时就是它的 owner id（`dockview-sash-drag:<n>`），这样看门狗点名的 owner 能直接回指到那一次会话。sash 不加兜底定时器——正常拖 sash 可以持续很久，自动释放会打断真实操作，也会掩盖泄漏。

正常路径记录 `started`、`ended`；`ended.reason` 可明确区分 `dockview-will-drop`、`dockview-did-drop`、`window-dragend` 或 `escape`。上一次会话没收到任何结束信号就被新拖拽顶替时记 `superseded`，与工作台销毁的 `disposed` 区分开。`fallback-timeout` 是需要排查的异常并使用 `warn`。重复的 `onWillDrop` / `onDidDrop` / `dragend` 回调按会话编号幂等忽略，不以陈旧会话编号制造噪声日志。每条实际会话记录都含会话编号、面板 id、结束理由、耗时和 Web owner 数量。

### 6.3 快捷键记录

只在能够得到受限 `commandId` 时记录：

- renderer DOM 捕获或 native forward 路径；
- 命令 id；
- `text-input-suppressed`、`overlay-blocked`、`disabled`、`dispatched` 或 `handler-rejected` 等结果；
- 当时的 active panel 类型与 overlay 数量。

不记录任意字符、终端键入、粘贴内容、路径、命令文本或原生 `chars`。原生侧已有的 router 决策 ring 继续只保留长度和判定信息。

### 6.4 Owner 滞留看门狗

`webRequestIds` 只活在 renderer 内存里，永远不进磁盘，所以只靠 JSONL 无法回答“到底是谁占着输入”。看门狗补上这一环：每 5 秒读一次输入路由快照，只在 `basePanel.kind === "terminal"` 且 `effectiveKind === "web"`（即 owner 确实把键盘挡在终端之外）时判定，超过阈值就发一条 `owner-stuck`，带上被点名的 owner id、当时的完整 owner 列表和持有时长。

- 阈值分层：拖拽类 owner（`dockview-tab-drag:` / `dockview-sash-drag`）15 秒即为异常；dialog、命令面板等 durable owner 放宽到 120 秒，避免正常长开浮层刷屏。
- 同一 owner 在一次连续持有内只报一次；owner 释放后遗忘，重新获取重新计时。
- **只观测，不释放。** 它不得成为隐式兜底——自动放掉 owner 会掩盖泄漏，让 bug 不可复现。
- owner id 只有静态种类名或 `种类:panelId`，不含用户文本；上报数组封顶 16 项、每项 96 字符。
- main 侧把 `owner-stuck` 与 `fallback-timeout` 一并升级为 `warn`，用户回传日志时 grep 级别即可定位。

### 6.5 快照、调试窗口与磁盘

renderer 持有固定上限的最近事件 ring，并将它放入 `TerminalDebugRendererSnapshot`。终端调试窗口新增“拖拽会话”和“快捷键分派”两段，能与现有 focus routing、native router decisions 对照。

每个受验证的事件通过窄 IPC 上报 main；main 使用 `createLogger("terminal.input-routing")`，自动复用 `src/main/diagnostics/daily-log-writer.ts` 的脱敏、大小限制、按日 JSONL 与 14 天保留策略。这样即时快照用于当场排查，磁盘日志用于重启后的回看。

## 7. 接口与文件边界

| 文件 | 变更职责 |
|---|---|
| `src/renderer/components/workspace/terminal-tab-drag-input-capture.ts` | Dockview tab 拖拽会话状态机与订阅 disposer |
| `src/renderer/components/workspace/host.tsx` | 在同一工作台边界安装/卸载 tab 拖拽捕获器 |
| `src/renderer/stores/terminal-input-routing-drag.ts` 或拆分后的 sash 文件 | 仅保留 sash 的全局 pointer 生命周期，并为每次 sash 会话写轨迹 |
| `src/renderer/lib/terminal-debug/owner-retention-watch.ts` | Owner 滞留看门狗：只观测、只点名，不释放 |
| `src/renderer/lib/terminal-debug/input-routing-trace.ts` | 有界轨迹、renderer→main 上报、快照读取 |
| `src/renderer/lib/keybindings/use-registry.ts` | 将已解析快捷键的分派结果写入轨迹 |
| `src/shared/contracts/terminal/debug.ts` | 快照中的输入路由诊断类型 |
| `src/shared/contracts/terminal/input-routing-diagnostics.ts` | IPC 请求的白名单 schema/type |
| `src/shared/ipc-channels.ts`、`src/preload/terminal-api.ts`、preload 全局类型 | 仅暴露 terminal 诊断上报 API |
| `src/main/ipc/terminal/input-routing-diagnostics.ts` | sender 校验、负载校验和结构化落盘 |
| `src/main/ipc/terminal/diagnostics-ipc.ts` | 聚合注册调试快照与窄诊断 IPC，避免膨胀终端入口 |
| `src/renderer/lib/terminal-debug/renderer-snapshot.ts`、调试窗口组件 | 合并和展示诊断轨迹 |

## 8. 明确禁止的反模式

1. 继续从全局 `.dv-tab` DOM `dragstart` 推测 Dockview tab 拖拽的开始。
2. 将 `window.blur` 当作跨窗口拖拽完成。
3. 用 tab 激活或终端点击清空全部 Web focus owner。
4. 让 transfer 模块持有或释放终端输入路由状态。
5. 通过 `setTimeout` 假定布局已经完成，而不先消费 Dockview 的 `onWillDrop` / `onDidDrop` / `dragend`。
6. 在 renderer 中直接写磁盘日志，或让主进程信任 renderer 传入的窗口身份。
7. 把原始键盘字符、终端输入、剪贴板内容或路径写入诊断。
8. 为快捷键诊断再建一条脱离 `TerminalDebugSnapshot` 的临时 console-only 日志。

## 9. 最小实施方案

1. 先为独立 tab 拖拽状态机写失败测试，覆盖开始、同窗口 drop、源 `dragend`、取消、跨窗口目标无会话、重复结束和兜底超时。
2. 把 tab 监听从全局 watcher 移到工作台边界；sash 保持原机制。
3. 新增有界 renderer 轨迹与共享 IPC schema；在 main 校验并接入既有日志 sink。
4. 把轨迹纳入 debug snapshot 和调试窗口。
5. 在快捷键注册表记录已解析命令的分派结果，不改变命令选择或快捷键行为。
6. 添加单元、组件、main IPC 与 Electron 回归；真机辅助功能环境补充真实原生焦点验证。

## 10. 验收矩阵

| 需求 | 证明方式 |
|---|---|
| 同窗口拖拽不遗留 Web owner | 控制器单测及真实 Electron 回归：owner 为零，trace 有同会话 `started/ended` 且无 `fallback-timeout`；断言不绑定具体结束原因 |
| 窗口外取消可恢复 | 单测：开始后仅 `dragend`，断言释放且结束原因为 `window-dragend` |
| 跨窗口源/目标职责分离 | 两个控制器测试：目标 `onDidDrop` 无会话不释放；源 `dragend` 释放自己的会话 |
| 缺失结束事件不无限锁死 | fake timer 触发兜底，断言释放并产生 `fallback-timeout` 警告轨迹 |
| 真实浮层不被误清 | 既有 input-routing 单测继续断言 `requestTerminalFocusIntent` 不会清除独立 durable owner |
| 快捷键可定位 | keybinding 单测：DOM 与 native-forward 两路径对同一已注册命令写出不同 route/outcome |
| 调试窗口可见 | renderer snapshot / 调试组件测试断言展示拖拽和快捷键轨迹 |
| 重启后仍可复盘 | main IPC 单测断言 validated event 通过 `createLogger("terminal.input-routing")` 输出；daily writer 测试覆盖脱敏和上限 |
| 仅凭日志即可点名泄漏 owner | 看门狗单测：拖拽类 owner 超 15 秒、durable owner 超 120 秒各报一次且只报一次，base 为 web 时静默，报后 owner 仍在；main 单测断言 `owner-stuck` 落 `warn` 且带 `stuckOwnerId` |
| sash 会话可复盘 | sash 单测：`pointerup` / `pointercancel` / `window-blur` / `dispose` 四种结束各自成对，session id 唯一且等于 owner id |
| 真实 native 焦点 | 有 macOS 辅助功能权限的 Electron e2e：拖拽后激活终端，断言 native `keyboardFocusTarget` 与 `isFirstResponder` 一致 |

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Dockview 内部移动不触发 `onDidDrop` | 同实例放置优先消费 `onWillDrop`；源窗口 `dragend` 仍覆盖取消与跨窗口；兜底只处理三者都缺失 |
| 跨窗口源窗口先 blur | 不再用 blur 结束会话，避免提前释放；以 `dragend` 为权威 |
| 诊断噪声过多 | 固定 ring 上限；仅记录低频拖拽生命周期和已解析的命令；主进程校验并复用磁盘上限 |
| 诊断泄露输入 | 字段白名单、长度上限、main sender 校验和既有日志脱敏；测试禁止原始文本字段 |
| Playwright 无法生成原生 AppKit 鼠标事件 | 单元/组件测试覆盖状态机；真实原生焦点验证固定在具有辅助功能权限的 macOS 环境 |

## 12. 结构闭环

本设计把“识别 Dockview 拖拽”“申请/释放输入所有权”“面板跨窗口转移”“记录诊断”“执行原生焦点”分开，但通过单向事件流连接。输入 owner 的开始与结束只由同一工作台生命周期控制器发起；快捷键与原生路由只提供观测，不反向修改拖拽状态；main 只负责经过校验的持久化。由此避免旧实现的全局 DOM 猜测、owner 粗暴清理、跨窗口 blur 终态和 console-only 排错路径。
