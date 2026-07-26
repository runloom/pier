# TUI 输入聚焦模型：探针、恢复与提交门禁

日期：2026-07-24
状态：已实现
范围：agent TUI 内部输入聚焦态的观测与治理——cursor-visible 探针、白名单自动恢复、增强输入提交门禁、原生 focus 转场两个不变量。不包含多 agent 调度的注入协议（场景 3 预留接口）。

相关：

- 增强输入编辑器：[`2026-07-22-rich-input-structured-composer-design.md`](./2026-07-22-rich-input-structured-composer-design.md)
- ghostty patches 清单：`native/Vendor/libghostty-spm/Patches/ghostty/README.md`（0103 / 0104）

## 1. 问题模型

部分 agent TUI（crush、cursor-agent 等）有**内部输入聚焦模型**，与终端键盘焦点是两层：

- crush：`m.focus ∈ {editor, main, sidebar}`；失焦（点消息区 / Tab）时
  `handlePasteMsg` 静默丢弃 paste（`return nil`），Enter 路由到消息区无绑定——
  注入完全 no-op（crush v0.86.0 源码核实）。
- cursor-agent 等：依赖终端 mode 1004 focus 上报（`ESC[I/O`）决定输入框聚焦；
  收到 focus-out 后输入框失焦且**不随随后的 focus-in 恢复**——paste 进框但
  Enter 不提交。

宿主三层症状都源于此模型：切 tab 后 TUI 输入不聚焦、增强输入发送被静默
丢弃（假成功清稿）、`\r` 可能误触 TUI 确认对话框。

## 2. 探针：cursor-visible（ghostty patch 0104）

**信号**：应用设置的 DECTCEM(?25) 光标模式位。现代 TUI 的惯例是「输入框
聚焦 ⇔ 硬件光标可见」——crush 逐分支核实（`ui.go` Draw 里
`textarea.Focused()` 门控，失焦返回 nil cursor；dialog 打开时返回 dialog
的光标，确认类 dialog 无光标）。

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
- 假阴性（自绘光标、恒 `?25l` 的 TUI）：自动恢复只对 catalog 白名单启用，
  误判爆炸半径锁在白名单内。
- busy（processing/tool）态不使用探针结果：各家运行态光标语义不一，避免
  误伤「运行中排队输入」。

## 3. 恢复原语 `ensureTuiInputFocus`

- **白名单**：`AgentCatalogEntry.inputFocusKey`（crush = Tab）。声明前提：
  逐一验证过「光标可见 ⇔ 输入聚焦」，且该键在失焦态是**确定性**聚焦动作
  （crush：Tab 在 chat/main 态必定 `textarea.Focus()`，ui.go:2553）。
  未声明的 agent 直接放行（行为不变）。
- **waiting 跳过**：权限确认等 dialog 态不自动注入。
- **per-panel in-flight 互斥**：并发触发（tab 激活 + ⌘⇧I）只发一次恢复键，
  防止 toggle 类按键双击反向切走。
- **确认窗口**：发键后 400ms 内 40ms 轮询探针确认；超时/unknown → false。

触发点：tab/panel 激活、点终端内容（focus-request 路径）、点已激活 tab
header、增强输入打开。场景 3（多 agent 调度）注入前复用同一原语形成
「probe → 恢复 → 再 probe → 注入 / 显式报错」闭环。

## 4. 提交门禁（增强输入 UI）

规则：**只认输入光标（DECTCEM）是否存在**，不认 FA `waiting`：

- 门禁信号：cursor-visible 探针 hidden → `unfocused`（500ms 轮询，**全
  agent**，含 busy「思考中」；unknown 不拦、后台 tab 停轮询）。
- **不**用 activity `waiting` 做发送门禁。
- 恢复键：仅 `inputFocusKey` 白名单（crush=Tab）在 ensure 时注入；Grok 等
  无恢复键时 hidden → 门禁拦发、ensure 失败。
- 表现：硬禁用发送 + 内联提示 `blockedUnfocused`（「未聚焦输入框」）+ 截空
  草稿 Enter 透传；光标 visible 才可提交。
- 点终端内容：**不关**增强输入；**吞掉**归还键盘（键仍钉在卡片，避免 limbo）。
  鼠标点到 TUI 输入区可复原聚焦；立刻重探光标以解除发送门禁。
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
发送门禁探针仍读 DECTCEM **模式位**（不受绘制 suppress 影响）。

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
- 单测：`tests/unit/renderer/tui-input-focus.test.ts`（原语）、
  `terminal-composer.test.tsx`（门禁 UI）、
  `tests/unit/main/terminal-send-text.test.ts`（settle 延迟 + 探针映射）、
  `terminal-focus-coordinator.test.ts`（拒绝可观测）。
