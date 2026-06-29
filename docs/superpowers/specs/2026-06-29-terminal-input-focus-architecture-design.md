# 终端输入与焦点架构重构设计

- 日期：2026-06-29
- 状态：设计待评审
- 相关前作：`docs/superpowers/specs/2026-06-23-keyboard-routing-design.md`（本设计取代其中的焦点归属部分）
- 触发问题：终端搜索时，终端光标与搜索框光标高速交替闪烁

## 1. 背景与目标

### 1.1 触发问题

在终端面板里按 `Mod+KeyF` 打开搜索框后，终端的原生光标与搜索框输入框的光标会高速交替闪烁，焦点在两者间反复横跳，搜索基本不可用。

### 1.2 这不是局部 bug，是架构问题

历史上已经尝试过一版修复（`e0327e7` 搜索框改用 exclusive scope、`babfaab` 浮层打开时拦截 native 焦点请求），但**仍然闪烁**，最终被 `2fa835e` 整体回退。回退还留下了一个自相矛盾的中间态：搜索框注册 `transient` scope，但 `onFocusRequest` 无条件释放 transient 且无保护检查，搜索框 `onFocusCapture` 又反复重注册——闭环未断。

根本原因在架构层：键盘焦点没有单一权威，被三个角色异步争抢。因此本设计的范围是**对终端区鼠标、键盘、快捷键、焦点这一整块做架构级重构**，而不只是修搜索 bug，目标是让未来任何浮在终端上的 web 元素（自动补全、AI 建议、悬浮卡片）天然免疫同类竞态。

### 1.3 目标

1. 彻底消除终端区焦点闪烁与竞态。
2. 建立单一焦点权威，三类区域用统一模型处理，消除特例。
3. 删除当前实现里的冗余与死代码。
4. 让焦点状态可显式驱动、可观测，使闪烁场景能写成自动化回归测试。

### 1.4 非目标

- 不改终端区鼠标几何命中（hitTest + `webOverlayRects`）这套，它是对的。
- 不改快捷键分发的双路径机制（DOM keydown 捕获 + IPC forward）与 menu 优先逻辑。
- 不涉及任务生命周期、任务台账等产品边界外内容。

## 2. 设计公理

> 键盘焦点的唯一权威在 native（`firstResponder` 所在层，与嵌入的 Ghostty `BaseTerminalController` 同构）。物理焦点（AppKit `firstResponder` 与 DOM `activeElement`）是它的纯投影。数据严格单向流动：意图流入 native，焦点投影流出，DOM 焦点事件永不回写状态。

## 3. 根因分析

macOS 一个窗口只有一个 key window、一个 `firstResponder`，这是 OS 强制的单一所有者。Pier 在同一个 `NSWindow` 里让原生 Ghostty NSView 与 Chromium WebContents 作为兄弟视图共存，于是出现两套独立焦点系统：AppKit `firstResponder` 与 DOM `activeElement`。当前实现在它们之上又叠了第三个角色（renderer 的意图状态），三方各自调用聚焦 API 且无单一仲裁。

闪烁的精确闭环（顺真实代码逐帧推导）：

1. 某次 routing 更新 target=web → native `applyFirstResponder` 因 activeTerminalId=nil 调 `window.makeFirstResponder(nil)`，连带把 Chromium WebContentsView 一起 resign，搜索框 input 被 blur。
2. 搜索框 input 被 blur → `<search onBlurCapture>` → `releaseSearchKeyboardFocus()` 删除 scope → 触发 routing 更新。
3. scope 清空后 `effectiveKeyboardFocusTarget()` 回退到 `baseKeyboardFocusTarget`，而 base 从没在打开搜索时被改过，仍是 `terminal` → target 翻转成 terminal。
4. routing 更新 target=terminal → native `makeFirstResponder(terminalView)`、`hostKeyboardActive=true` → 终端光标点亮。
5. 与此同时 main 处理较早那帧 web 快照 → `webContents.focus()` → 搜索框 input 重新拿 DOM 焦点 → `onFocusCapture` 重注册 scope → target 又翻回 web。
6. 回到第 1 步，终端光标与搜索框光标高速交替。

四个根因（按重要性）：

| 编号 | 缺陷 | 为什么是架构问题 |
|---|---|---|
| A | 焦点权威分裂成三个角色（native `firstResponder` / main `webContents.focus` / renderer DOM focus），靠异步 IPC 协商，无单一仲裁 | 三方发出互相矛盾的聚焦指令并竞态，是所有症状的总根 |
| B | DOM 焦点事件回写路由状态（`onFocusCapture`/`onBlurCapture` 注册/注销 scope） | 形成「焦点 → 状态 → 焦点」反馈环。正确方向应是状态单向驱动焦点 |
| C | 打开浮层时不更新 `baseKeyboardFocusTarget` | scope 一旦被瞬时清空，effective 立刻 snap 回 terminal，缺少「浮层打开期间焦点归属确定」的不变量 |
| D | web target 走 `makeFirstResponder(nil)` 再单独 `webContents.focus()` | 非原子两步，先 resign 再异步补回，本身制造 blur→focus 抖动 |

`exclusive` 版本仍闪的原因：它能在第 3 步挡住回退 terminal，但挡不住第 1 步 `makeFirstResponder(nil)` 对搜索框的 blur，也挡不住第 4/5 步两个聚焦写入者的竞态。症结不在 scope 种类，而在「谁是焦点唯一真相」从未确立。

## 4. 业界调研（限定本场景）

纯 DOM 焦点方案（React Aria FocusScope、VS Code 基于 xterm.js 的 find widget）**不适用**：它们只管 `document.activeElement`，不知道 DOM 之外还有一个原生 Ghostty NSView，没有 native `firstResponder` 与 web 焦点的分裂。本场景是「原生终端表面 + Chromium 浮层共存于同一窗口」，对口参考是：

1. **Ghostty 自身（我们正嵌入它）**：`BaseTerminalController` 是 focused-surface 状态的唯一权威，侦测 `firstResponder` 变化来更新自己的 `focusedSurface`；点击另一个 split 时 native 直接 `makeFirstResponder` 并 `return nil` 消费事件；用限频的 `reassertTerminalSurfaceFocus` + 目标校验避免抢陈旧焦点。来源：ghostty-org/ghostty discussion #11405、DeepWiki window-and-tab-management。
2. **Electron issue #42922**：同一窗口嵌两个 web 视图无法不互相抢焦；「overlay 一拿焦点就立刻把主视图重新聚焦」这种绕过会因频繁 blur/focus 导致抖动——正是我们 `onFocusCapture` 闭环。文档同时确认：在 macOS 上，有焦点意味着 WebContents 就是该 window 的 `firstResponder`，即 Chromium 视图本身参与同一套 `firstResponder` 体系。
3. **AppKit**：`window.makeFirstResponder` 是原子仲裁原语，由 window 协调 resign/become 顺序，优于跨多视图手工管理。来源：Apple makeFirstResponder 文档。

结论：业界有两个终态，取决于产品选择——终端用 DOM（xterm.js）则走全 DOM 单一焦点系统（VS Code / Hyper / Tabby）；终端用原生表面则 native 持焦点权威（Ghostty 自身、Pier）。Pier 已选原生 Ghostty，对应终态是 native 持权威。

## 5. 目标架构：三层分级焦点所有权

终态形态是三层分级所有权，每层只管自己一级、严格从属上一层：

```
Level 0  OS 层    NSWindow.firstResponder —— 一个 NSView         (macOS 强制单一所有者)
            ⊃
Level 1  仲裁层   terminal surface  vs  web layer               ← native FocusArbiter（本设计核心）
            ⊃
Level 2  DOM 层   web 内部哪个元素拿 caret                        ← 浏览器 / React 自管，从属于 Level 1
```

当前 bug 的本质是 Level 1 被三方争抢。本设计把 Level 1 归一到 native。Level 2（搜索框 input 拿 caret）仍由浏览器管，是 Level 1 授予 web 后的从属动作，不参与仲裁。

把焦点权威放在 native 是本场景的判断而非偏好：最高频、最延迟敏感的焦点触发（点终端）本身发生在 native，焦点原语 `firstResponder` 也住在 native。让 renderer 持权威意味着 native 鼠标事件要先上行 IPC 再下行，这条往返就是竞态窗口；native 持权威直接消灭它。

精炼约束：native 只放机制 + 最小仲裁规则（一个栈 + 归约函数），「何时发意图」的产品策略仍在 renderer，避免 Swift 沉淀复杂 UI 逻辑。

## 6. 详细设计

### 6.1 native FocusArbiter（唯一真相源）

现有的 `WindowKeyboardState.keyboardFocusTarget` 从「renderer 的镜像」升格为权威，扩成每窗口一个的仲裁器：

```
FocusArbiter (per window, 在 GhosttyBridgeImpl)
  basePanel:    .terminal(panelId) | .web      // dockview 活跃面板
  webRequests:  [scopeId]                       // 浮层焦点请求栈（替代 renderer 的 webFocusScopes）
  windowFocused: Bool

  effectiveTarget:
      webRequests.isEmpty ? basePanel : .web    // 唯一派生真相，只在 native 计算
```

`acceptsTerminalKeyboard = windowFocused && effectiveTarget == .terminal(id)` 保持不变，作为键盘路由闸门。

### 6.2 意图流入（native 是 sink）

| 意图 | 路径 | 说明 |
|---|---|---|
| 终端鼠标点击 | native 本地直接置 `basePanel=.terminal(id)` 并 apply | 砍掉「forward → renderer → IPC 回环」，消除竞态延迟 |
| 浮层打开/关闭 | renderer → IPC `requestWebFocus(id)` / `releaseWebFocus(id)` | push/pop 纯生命周期，替代 `registerWebFocusScope` |
| dockview 切面板 | renderer → IPC `setBasePanel(target)` | 仅报意图 |
| 窗口 focus/blur | main → arbiter | 复用现有 `restoreActivePanelFocus` / `blurActivePanelFocus` |

终端鼠标点击不再被拦截：浮层打开时点终端是一次合法所有权转移，native 本地置 `basePanel=.terminal`，**搜索框保持可见但失焦**（可见性与焦点所有权分离，对齐 Ghostty 与 VS Code）。这修正了被回退的 `babfaab`「拦截 native 焦点请求」导致的「点不到别的面板」问题。

### 6.3 焦点投影（native 编排两端，各一个写入者）

```
effectiveTarget == .terminal(id):
    window.makeFirstResponder(terminalView)     // 仅当当前不是它（幂等）
    surface.hostKeyboardActive = (panelId == id)

effectiveTarget == .web:
    所有 surface.hostKeyboardActive = false
    fire focusWebCallback(windowId)  →  main webContents.focus()   // 只一次，按 target 去重
    不再 window.makeFirstResponder(nil)                            // 消除根因 D 的两步抖动
```

投影必须幂等 + 限频 + 目标校验（移植 Ghostty `reassert` 思路）：reassert 只在 target 变化或 `firstResponder` 漂移出目标时触发，且断言前校验目标 panel 仍存在，避免抢陈旧焦点；连续帧不重复 slam。

### 6.4 斩断反馈环

- 删除搜索框 `onFocusCapture`/`onBlurCapture` 的 register/unregister 逻辑（Electron #42922 点名的"聚焦即回焦"闪烁反模式）。
- 焦点请求由**显式意图**驱动，DOM 的 blur/focus 永不回写焦点状态。
- web 被授予后，renderer 只做一次性 caret 放置（`queueMicrotask` + `inputRef.focus`），不再被 focus 事件反复驱动。

实现层把"浮层焦点请求"分成两类（见 6.6）：
- **共存浮层**（搜索框这类浮在仍可点击的终端上的小浮层）：请求绑在"激活"态，由 `terminal-overlay-focus.store.ts` 协调器持有，单一活跃浮层拥有键盘；终端点击（`onFocusRequest`）调 `yieldToTerminal()` 让出，浮层保持可见但失焦（并一次性 blur 其 input 保持 DOM 一致）；点回浮层 input 重新激活；Esc 关闭。
- **全屏/独占浮层**（命令面板、设置、拖拽）：覆盖整个 router，终端点击到不了 native，挂载期间直接持 `requestTerminalWebFocus(id)`，卸载即释放。

### 6.5 三类区域目标处理

鼠标几何层（`webOverlayRects` 命中）三区不变。键盘/焦点层三区坍缩为两态：

| | 区域 1 终端 native 区 | 区域 2 浮在终端上的 web 区 | 区域 3 其他 web 区 |
|---|---|---|---|
| 鼠标 | hitTest 命中 terminal rect → Ghostty NSView | 命中小 `webOverlayRect` → nil → DOM | 不在 terminal rect 或全屏浮层 → nil → DOM |
| 键盘/焦点 | arbiter target=terminal | arbiter target=web（与区域 3 同一条路径） | arbiter target=web |

区域 2 与区域 3 在键盘语义上完全相同，差别只在鼠标几何，不再有 `transient` 特例。

### 6.6 浮层契约（鼠标几何 + 键盘焦点）

任何浮在终端上的 web 元素都有两个正交的需求，统一在 primitive 层一次解决：

- **鼠标几何**：必须把自身矩形注册进 `webOverlayRects`，否则 native hitTest 把那片坐标当终端区、鼠标穿透到 Ghostty NSView（tooltip 穿透 bug 的根因）。
- **键盘焦点**：会吃键盘的浮层（dropdown / select / popover / context-menu）需在打开期间持一个 web 焦点请求，让终端让出键盘；不吃键盘的（tooltip / hover-card）只注册几何。

统一 hook `src/renderer/panel-kits/terminal/use-terminal-overlay.ts`：

```ts
useTerminalOverlay({ focus })   // 返回 callback ref，挂到 Radix Content；
                                // 挂载注册几何（+ focus 时持 web 焦点请求），卸载释放
```

接在 shadcn 浮层 primitive 的 Content 上（tooltip/hover-card focus=false；popover/select/dropdown/context-menu/menubar focus=true，含 SubContent），用 `useComposedRefs` 与调用方 ref 组合、不破坏 Radix 定位。**改一次 primitive 层，所有浮层（含未来新增）自动正确**——这是"避免后续浮层再炸"的架构保证。组件不需要懂 native、不碰 `firstResponder`、不写焦点状态。

搜索框这类**共存小浮层**额外走 6.4 的激活态协调器（`terminal-overlay-focus.store.ts`），以支持"点终端让出但保持可见"。命令面板/设置等**全屏浮层**仍用 `registerTerminalFullscreenWebOverlay` + `requestTerminalWebFocus`（挂载即持有）。

## 7. 冗余删除清单

| 编号 | 删除 / 退化 | 位置 | 理由 |
|---|---|---|---|
| 1 | `WebFocusScopeKind`（exclusive/transient）+ `TerminalKeyboardFocusTarget.scope` | `shared/contracts/terminal.ts` | web 请求就是 web 请求，种类区分只为 renderer 算 effective，下沉后无意义 |
| 2 | `baseKeyboardFocusTarget` / `effectiveKeyboardFocusTarget` / `sameKeyboardFocusTarget` / `hasExclusiveWebFocusScope` / `releaseTransientWebFocusScopes` | `renderer/stores/terminal-input-routing.store.ts` | effective 计算移入 native |
| 3 | `registerWebFocusScope` 的 Map 实现 | 同上 | 换成薄 IPC 意图发送器，无本地 map |
| 4 | 搜索框 `onFocusCapture`/`onBlurCapture` 注册逻辑 | `renderer/panel-kits/terminal/terminal-search-bar.tsx` | Electron #42922 点名的闪烁反模式 |
| 5 | `use-terminal-search-keyboard-opening.ts`（opening transient 双 scope） | 整文件 | 与 keyboard scope 二选一冗余，合并成一次 `requestWebFocus` |
| 6 | `onFocusRequest` 的焦点决策回环 | `renderer/components/workspace/workspace-host.tsx` | native 本地决策；renderer 仅收通知做 dockview active 同步 |
| 7 | `setTerminalBaseKeyboardFocusTarget` 散落调用 | `workspace-host.tsx` 多处 | 统一成 `setBasePanel` 意图 |

待评估：`presentation` 与 `input-routing` 两套并行的 `nativeApplySequence` / `staleDiscard` 状态机是否合并去重原语。geometry 与 focus 是不同数据，倾向保留两份数据但共享 stale-guard 工具，具体在实现阶段定。

## 8. 可观测性与可测试性要求

技术验证记录（见第 9 节）暴露了一个架构级问题：当前「聚焦到终端」隐式耦合在 native 真实事件上，无法注入、难以自动化测试。新架构必须修正这一点：

- arbiter 能被显式意图驱动（`requestWebFocus` / `releaseWebFocus` / `setBasePanel`），不依赖真实 NSEvent。
- 全部焦点状态通过 `debugSnapshot` 可观测（`isFirstResponder` / `hostKeyboardActive` / `keyboardFocusTarget` 已有）。
- 由此「开搜索零振荡」可写成自动化回归测试：注入终端焦点意图 + 打开搜索意图，采样 `debugSnapshot` 时间线，断言 `keyboardFocusTarget` 与 `isFirstResponder` 切换次数恰好一次、无振荡。

## 9. 可行性现状

所需管道全部已存在：native→main 回调（`forwardCmdKey` / `forwardRightMouse` / `forwardFocusRequest` 同款）、`webContents.focus()`、`debugSnapshot` + `TerminalDebugIssue` 检测器（现成回归预言机）。本次是重组权威归属，不是造新能力，整体可行性高。

唯一真正的未知：当 arbiter target=web 由 native 回调触发 `webContents.focus()` 后，Electron 42 下 Chromium 是否稳定持有 `firstResponder` 且终端不抢回。

技术验证记录：用 Playwright e2e + `debugSnapshot` 尝试自动复现，结论是**自动化不可达**——让终端拿到 `firstResponder` 必须走 native 真实 mouse-down → focus-request 链，而 Playwright 合成事件进不了 native NSEvent 管线，且该窗口在自动化环境非 OS key window，前置状态到不了（实测 `keyboardFocusTarget` 恒为 web、`activeTerminalPanelId` 恒为 null）。因此 Q2 的实测改为收进实现计划第一个里程碑，在真机 dev 会话中确认。

兜底论证（使该未知不阻塞推进）：即便 `webContents.focus()` 偶尔抢不稳 `firstResponder`，键盘路由由 `acceptsTerminalKeyboard`（= arbiter target）闸住，键不会打进终端，最坏只是光标外观短暂瑕疵，非功能性故障。

## 10. 迁移路径

1. Swift：把 `WindowKeyboardState` 扩成 `FocusArbiter`（加 `webRequests` 栈 + `basePanel`，native 计算 `effectiveTarget`）。**第一个里程碑同时在真机验证 Q2**（target=web 时 `webContents.focus()` 后 `firstResponder` 是否稳定不抢回）。
2. IPC：新增 `requestWebFocus` / `releaseWebFocus` / `setBasePanel` 意图通道，复用现有 `nativeApplySequence` 单调序号丢弃 stale。
3. 终端 mouse-down：native 本地直接置 `basePanel=.terminal` 并 apply；仍通知 renderer 同步 dockview active，但不再等 renderer 决定焦点。
4. renderer：把 `registerWebFocusScope` / `baseKeyboardFocusTarget` / `effectiveKeyboardFocusTarget` 退化为薄意图发送器；落地 `useTerminalWebFocus`；删搜索框 onFocus/onBlur 反馈；保留一次性 caret。
5. native 投影：实现幂等 + 限频 + 目标校验的 apply。
6. web 聚焦：由 native 回调触发 `webContents.focus()`，按 target 去重。
7. 按第 7 节删除冗余与死代码。

每步可独立 typecheck / lint / 单测，渐进可验证。

## 11. 测试计划

- 单测：`effectiveTarget` 归约（给定意图序列）；`webRequests` 栈 push/pop 与释放后恢复；stale 序号丢弃。
- 自动化回归（依赖第 8 节可测试性改造）：注入终端焦点意图 → 打开搜索意图 → 采样 `debugSnapshot`，断言切换恰好一次、零振荡。
- 真机验证（实现阶段）：开搜索时点另一终端 → target=terminal 且搜索框仍可见；关搜索 → 焦点恢复到打开前终端；多 panel / 多窗口状态隔离；一个用 `useTerminalWebFocus` 的占位浮层行为与搜索一致。
- 复用 `TerminalDebugIssue` 检测器作为回归预言机（`input_routing_keyboard_first_responder_mismatch` 等不报）。

## 12. 风险与开放问题

- Electron 42 `firstResponder` 抢回行为（第 9 节 Q2），实现第一里程碑实测，有兜底论证。
- native 看不到 DOM 内部焦点（哪个 input），caret 放置仍由 renderer 一次性做，必须严格保持从属、不回写。
- IPC 乱序：意图带单调序号，native 丢弃 stale（复用现有机制）。
- 前提条件：本终态成立于「Pier 坚持原生终端表面」。若改用 DOM 终端，终态会翻到另一形态——但这不在当前规划内。

## 13. 范围外

- 鼠标几何命中、快捷键双路径分发、menu 优先逻辑保持不变。
- 不重写无关的 presentation 几何管线（仅评估共享 stale-guard 工具）。
