# TUI 输入聚焦模型：探针、恢复与发送确认

日期：2026-07-24
状态：已实现
范围：智能体 TUI 内部输入聚焦态的观测与治理——光标探针、会话内观察、白名单自动恢复、增强输入的风险提示与发送前确认、原生 focus 转场两个不变量。不包含多智能体调度的注入协议（场景 3 预留接口）。

相关：

- 增强输入编辑器：[`../../archive/superpowers/specs/2026-07-22-rich-input-structured-composer-design.md`](../../archive/superpowers/specs/2026-07-22-rich-input-structured-composer-design.md)
- ghostty patches 清单：`native/Vendor/libghostty-spm/Patches/ghostty/README.md`（0103 / 0104）

## 1. 问题模型

部分智能体 TUI（crush、cursor-agent 等）有**内部输入聚焦模型**，与终端键盘焦点是两层：

- crush：`m.focus ∈ {editor, main, sidebar}`；失焦（点消息区 / Tab）时
  `handlePasteMsg` 静默丢弃 paste（`return nil`），Enter 路由到消息区无绑定——
  注入完全 no-op（crush v0.86.0 源码核实）。
- cursor-agent 等：依赖终端 mode 1004 focus 上报（`ESC[I/O`）决定输入框聚焦；
  收到 focus-out 后输入框失焦且**不随随后的 focus-in 恢复**——paste 进框但
  Enter 不提交。

宿主三层症状都源于此模型：切 tab 后 TUI 输入不聚焦、增强输入发送被静默
丢弃（假成功清稿）、`\r` 可能误触 TUI 确认对话框。

## 2. 探针：cursor-visible（ghostty patch 0104）

**信号**：应用设置的 DECTCEM(?25) 光标模式位。「输入框聚焦 ⇔ 硬件光标可见」
**不是**通用惯例，只在部分 TUI 成立，必须逐个智能体核实后在 catalog 声明
`inputFocusProbe: "cursor"`。

**已核实成立**：

- crush：逐分支核实（`ui.go` Draw 里 `textarea.Focused()` 门控，失焦返回 nil
  cursor；dialog 打开时返回 dialog 的光标，确认类 dialog 无光标），实测进入
  chat 后聚焦 `?25h`、Tab 切走 `?25l`、切回 `?25h`。
- grok：pty 实测首帧 `?25l` 后转 `?25h` 并维持，浏览态（提示行 `Space:prompt |
  Enter:open`，输入框显占位文案）与聚焦态可区分；无确定性恢复键，故只声明
  probe、不声明 `inputFocusKey`（hidden 时提示风险，发送时由用户确认）。

**反例（2026-07-27 pty 实测，均在输入框聚焦、提示符可用时恒 `?25l`）**：
claude v2.1.220、gemini、opencode、droid、cursor-agent。这些 TUI 自绘光标
（把插入点画成反色块/字符），不靠硬件光标，探针对它们恒 hidden。

- C API：`ghostty_surface_cursor_visible()`，读 `io.terminal.modes` 的
  `.cursor_visible`（`renderer_state.mutex` 保护，与核心现有写法一致）。
- 与 patch 0103 正交：0103 是渲染层 suppress（web 浮层时藏光标），不改
  模式位；探针读的是**应用请求的**模式位，不是「最终画没画」。
- 链路：TerminalSurface → AppTerminalView（surface 缺失 → nil）→
  GhosttyBridge（1/0/-1）→ addon → main `readTerminalCursorVisibility`
  （**三态** `visible / hidden / unknown`）→ IPC → renderer。

**边界（设计时已规避）**：

- `unknown` ≠ `hidden`：surface 未创建 / addon 未加载 / native 抛错一律
  `unknown`，**禁止当作「失焦」行动**。
- 假阴性（自绘光标、恒 `?25l` 的 TUI）：**探针本身**只对 catalog 声明
  `inputFocusProbe: "cursor"` 的智能体启用，未声明者不读探针、不提示风险。
  否则自绘光标 TUI 会持续误报（2026-07-27 claude 回归即此）。
- `processing` / `tool` 期间仍可观察探针，但风险提示不禁用发送；`waiting`
  下禁止自动注入恢复键，避免改变终端确认对话框的选项。

### 2.1 会话内观察

catalog 声明只是**先验**：上游改版后「聚焦 ⇔ `?25h`」可能失效，而失效方向
可能是恒 hidden。为减少误报，模块
`src/renderer/panel-kits/terminal/tui-cursor-semantics.ts` 再加一层会话内观察：

- 每个面板活动会话维护 `{activitySpawnedAt, agentId, armed, last}`；`armed`
  仅表示**本会话实际观察到过一次 `visible`**，不是语义已被自动证明。
- 判定不变量（探针与发送前检查共用）：`visible` → 放行并 arm；`hidden` 且
  已 armed → 提示风险并尝试恢复；`hidden` 且未 armed → 放行；`unknown` →
  放行。恢复键也只在 armed 后注入。
- 同一 `panelId` 换智能体或重启同一种智能体时，`agentId` / `spawnedAt` 任一
  变化都会让旧结论作废；异步返回的旧探针不得污染新会话。
- 表容量上限 `MAX_TRACKED_PANELS = 64`，按最近最少使用（LRU）顺序淘汰。
- 效果：语义漂移时退化为「不提示或允许用户确认后发送」，不会让发送入口
  消失。诊断用 `describeCursorSemantics(panelId)`。

## 3. 恢复原语 `ensureTuiInputFocus`

- **两级声明**：`inputFocusProbe: "cursor"` 决定是否读探针；`inputFocusKey`
  （crush = Tab）决定 hidden 后能否自动恢复。声明 key 的前提是该键在失焦态
  是**确定性**聚焦动作（crush：Tab 在 chat/main 态必定 `textarea.Focus()`，
  ui.go:2553）。**未声明 probe 的 agent 不探针、直接放行**（行为等同没有这层）。
- **waiting 跳过**：权限确认等对话框状态不自动注入恢复键。
- **按活动会话互斥**：同一会话并发触发（标签页激活 + ⌘⇧I）只发一次恢复键，
  防止切换类按键双击反向切走；同一面板的新会话不得复用旧 Promise。
- **确认窗口**：发键后 400ms 内每 40ms 轮询探针确认；超时 → false；
  `unknown` 不当作失焦，按允许发送处理。

触发点：tab/panel 激活、点终端内容（focus-request 路径）、点已激活 tab
header、增强输入打开。场景 3（多智能体调度）注入前复用同一原语形成
「探测 → 恢复 → 再探测 → 注入 / 显式确认」闭环。

## 4. 风险提示与发送前确认（增强输入 UI）

规则：**只在声明 `inputFocusProbe: "cursor"` 的智能体上把输入光标
（DECTCEM）作为风险信号**，不把前台活动状态直接当作输入聚焦结论：

- 提示信号：光标探针为 hidden **且该会话已观察到 visible（§2.1 armed）** →
  `unfocused`（500ms 轮询，仅声明 probe 的智能体；`unknown` 不提示、未观察到
  visible 不提示、后台标签页停止轮询）。
- **未声明 probe 的智能体（claude / gemini / opencode / droid /
  cursor-agent …）不轮询探针、直接发送**，因为它们的硬件光标与输入聚焦无关。
- 风险提示**不禁用发送按钮**，也不把 `waiting` 等活动状态当作发送门禁。
- 恢复键：仅 `inputFocusKey` 白名单（crush=Tab）在 ensure 时注入，且同样要求
  已观察到 visible；`waiting` 下不注入。
- 表现：内联提示 `blockedUnfocused`（「终端输入框可能未聚焦」），但有效草稿的
  发送按钮保持可用。空草稿 Enter 透传仍被截住，避免误触 TUI 对话框。
- 用户发送时重新检查：恢复成功 → 直接发送；恢复失败或没有恢复键 →
  `showAppConfirm`（`blockedUnfocusedTitle` / `blockedUnfocusedBody` /
  「仍然发送」`sendAnyway`）。取消时保留草稿，确认后继续发送。
- 点终端内容：**不关**增强输入；**吞掉**归还键盘（键仍钉在卡片，避免 limbo）。
  鼠标点到 TUI 输入区可复原聚焦；立刻重探光标以解除风险提示。
  关闭只走 Esc / 发送成功 / 资格失效。
- 防交错：renderer `sendingRef` + main `enqueueTerminalSend`。

## 5. 原生 focus 转场的两个不变量（缺一不可）

症状：打开增强输入瞬间向 TUI 发瞬时 `ESC[O`，输入框失焦不再恢复。

**不变量 A（转场顺序，`applyTerminalWindowState`）**：打开浮层先 **pin
surface focus**（`hostCursorHidden` 作保活位，**不**视觉藏光标）再移交
first responder；关闭浮层反之。
反证（打开方向若先交 FR）：`resignFirstResponder` 那一帧
`(FR✗ || pin✗ || hostKeyboardActive✗) = false → ESC[O`，随后挂 pin
再 `ESC[I`——瞬时 pair 复活。

**不变量 B（focus 公式，`synchronizeHostFocusState`）**：
`focused = isKeyWindow && (FR===self || hostCursorHidden || hostKeyboardActive)`。
反证（关闭方向若只看 `FR || pin`）：`makeFirstResponder` 与 WKWebView
resign 竞态（Chromium 在 DOM 输入聚焦时滞后/拒绝）使「摘 pin 那一帧」
FR 未落回终端 → 派生 `false → ESC[O`；`hostKeyboardActive`（coordinator
下发的逻辑归属，无竞态）入 OR 后该帧恒为 true。

**视觉**：`cursorSuppressed = !hostKeyboardActive || hostCursorHidden`。
增强输入打开（pin）时 **suppress 绘制光标**（只让 composer caret 闪烁）；
输入聚焦探针仍读 DECTCEM **模式位**（不受绘制 suppress 影响）。

分工：**打开方向靠顺序（A）、关闭方向靠公式（B）**。两处注释内有完整
逐帧推演（`GhosttyBridge.swift` applyTerminalWindowState、
`AppTerminalView+Lifecycle.swift` synchronizeHostFocusState）。

已知边缘：两面板同时一开一关 composer 时，关闭方可出现一次瞬时 pair
（1ms 自愈），不处理。

## 6. 验证手段

- `PIER_TERMINAL_DEBUG_LOG=1 pnpm dev`：native input/lifecycle 通道
  （`surface text` / `surface key ... result` / `surface focus=`），
  转场应全程无 `surface focus=false`。
- main 侧 `acceptNativeFocusIntent` 拒绝写 `lastError`
  （`focus-intent-rejected:*`），终端 debug 窗口可见。
- `pnpm probe:cursor-semantics [--keep] -- <智能体命令> [参数…]`
  （`scripts/probe-agent-cursor-semantics.mjs`）：经 `script(1)` 在真实 tty 里跑
  智能体，**由人手动**在聚焦态与浏览态之间切换数次再退出。脚本只整理
  `?25l/h` 翻转序列并判断记录是否足以人工核对；末态取决于退出前所在界面，
  不能单独证明语义。只有人工确认翻转与操作一一对应后才能声明 probe。
  `--analyze <记录文件>` 可复分析已有记录。新增/复核智能体声明前必须跑一次。
- 单测：`tests/unit/renderer/tui-input-focus.test.ts`（原语）、
  `tests/unit/renderer/tui-cursor-semantics.test.ts`（会话隔离/淘汰）、
  `terminal-composer.test.tsx`（风险提示、确认与发送）、
  `tests/unit/main/terminal-send-text.test.ts`（settle 延迟 + 探针映射）、
  `terminal-focus-coordinator.test.ts`（拒绝可观测）。
