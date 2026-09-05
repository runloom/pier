# 终端视口按键所有权金标准

日期：2026-09-04
修订：2026-09-06 — 右键菜单、命令面板与 Cmd+↓ 复用原生回到底部动作。
状态：现行权威
范围：裸方向键 / Page Up/Down 与宿主 `NSScrollView` 滚动条壳的键盘隔离；
Ghostty `scroll-to-bottom` keystroke follow 的按键族收窄；composer 空草稿
透传；Pier 不得另写裸方向键滚动键表；显式回到底部菜单命令与 Cmd+↓。
不包含：滚轮 / 拖拇指、`Cmd+PageUp/Down` / `Cmd+Home/End` 等 Ghostty 默认
显式视口键、自绘 overlay 滚动条（已退役）。

背景缺陷：`197029de` 把 Pier 自绘 overlay 换成 Ghostty 同款系统条
（`scrollbar=system` + `AppTerminalScrollView` 镜像 `SurfaceScrollView`）。
视口仍归 libghostty，但有两条互不替代的泄漏：

1. `FocusNotifyingScrollView` 曾是裸 `NSScrollView`。AppKit 默认把 ↑↓ / Page
   当成文档 `scrollLine*` / `page*`；键一旦落到壳上，会 `scroll_to_row`，
   与 Cursor / Codex 选单一键双效。Ghostty.app 用 `doCommand(by:)` 吞掉这些
   selector（ghostty#2526）。
2. Ghostty 默认 `scroll-to-bottom = keystroke`：任何编码进 PTY 的键（含裸
   ↓）在 `Surface` 里 `scrollViewport(.bottom)`。壳隔离挡不住——`keyDown` /
   `sendKeyPress` 都走 `ghostty_surface_key`。

Pier **没有** `arrow_down=scroll_*` 产品绑定。业界默认仍是「打字回 live、
输出不追」；AI TUI 在主屏堆对话时，裸方向键不该当 follow。

## 一句话终态

裸方向键、Page Up/Down 只编码进 PTY / TUI，不得移动宿主滚动条，也不得把
视口拉回 live。打字 / Enter / Backspace 以及带 Ctrl/Alt/Super 的和弦仍回
live。宿主滚动条只做滚轮、拖条；显式视口键由 Ghostty 执行。Cmd+↓ 直接
回到底部，不依赖 TUI 的 shell 提示符标记。禁止再写一套宿主滚动算法。

## 所有权（法律）

1. **视口主人**：libghostty。宿主只镜像 chrome（`TerminalScrollbarGeometry`），
   live 拖条 / 滚轮才 `scroll_to_row`。编程 `scroll(to:)` 不得变成
   `scroll_to_row`（`applyingProgrammaticClip`）。
2. **键盘主人**：当前 keyboard target。终端聚焦 → `AppTerminalView.keyDown` →
   Ghostty；composer 空草稿 → `passthroughKeyPressForKey` → `sendKeyPress`
   （绕过 NSScrollView，保持）。
3. **滚动条壳**：`FocusNotifyingScrollView` 不得成为 first responder / key view，
   不得把文档导航 selector 变成 clip 移动。键落到壳上必须转给
   `terminalView.keyDown` / `keyUp`，禁止 `super.keyDown`。
4. **键表**：保留 `super+backspace=text:\x15`，仅增加
   `super+arrow_down=scroll_to_bottom`。禁止裸 `arrow_*=scroll_*` /
   `scroll_page_lines`。Ghostty 默认保留：`Shift+↑↓` 扩选区；macOS
   `Cmd+↑` / `Cmd+Shift+↑↓` = `jump_to_prompt`；`Cmd+Page*` /
   `Cmd+Home/End` 仍是显式滚视口。Cmd+↓ 不注册宿主 keybinding 或转发白名单。
5. **keystroke follow（方案 C）**：appearance **不得**写
   `scroll-to-bottom = no-keystroke`（保持 Ghostty 默认 `keystroke, no-output`）。
   收窄只走 Pier patch `0109-keystroke-follow-skip-nav-keys`：裸 ↑↓←→ /
   Page（含小键盘）编码进 PTY 但不 `scrollViewport(.bottom)`；可打印字符 /
   Enter / Backspace 以及 Ctrl/Alt/Super 和弦仍回 live。Shift-only 方向键
   仍算导航（不 follow）。禁止按后回写 offset 的宿主 hack。

## 滚动条壳隔离（对齐 Ghostty.app 意图）

单一实现：`AppTerminalScrollView.swift` 内 `FocusNotifyingScrollView`。

- `acceptsFirstResponder = false`、`canBecomeKeyView = false`
- `keyDown` / `keyUp`：转给 `terminalView`，不调用 `super`
- 覆盖并空实现键盘文档导航：`moveUp/Down/Left/Right`、`scrollLineUp/Down`、
  `pageUp/Down`、`scrollPageUp/Down`、`moveToBeginningOfDocument` /
  `moveToEndOfDocument`（避免壳层把 `Cmd+↑↓` 先做成 AppKit 滚到顶/底；
  提示符跳转与回到底部均由 Ghostty 键表在 `terminalView.keyDown` 里执行）
- 滚轮、`didLiveScroll` → `scroll_to_row`、`applyScrollbarState` 编程 clip 不动

`AppTerminalView.doCommand(by:)` 继续禁止 `super.doCommand`（记录后重放硬件键）。

## 显式回到底部

- 右键 `terminal/content` 与命令面板共用 `pier.terminal.scrollToBottom`，经
  `performOperation(panelId, "scrollToBottom")` 的既有 IPC / allowlist 调用
  `performTerminalBindingAction(windowScopedPanelId, "scroll_to_bottom")`。
  视口变化与 macOS `Cmd+↓`、Ghostty 默认 `Cmd+End` 使用同一原生动作。
- 菜单在查找之后（`1_navigation` / 0），清屏与关闭之前。macOS 的
  `Mod+ArrowDown` 仅是提示，不注册 Pier keybinding；其它平台不显示此提示。
- 原生 `Cmd+↓` 默认的 `jump_to_prompt:1` 在没有后续 OSC 133 标记时不移动，
  因此 Pier 将该键映射到 `scroll_to_bottom`，适用于所有终端，无需识别 TUI。
  提示符导航继续使用 `Cmd+Shift+↓`。MacBook 的 End 是 Fn+→，Cmd+End
  对应 Cmd+Fn+→；Fn+↓ 是 Page Down，不能等同为 End。
- 右键使用 `sourcePanelId`；命令面板使用当前终端。仅原生创建成功且仍有
  layout anchor 登记的终端可用；恢复的智能体结果页、创建中/失败、非终端
  均禁用，执行时重新检查。复用生命周期登记，不从面板类型推断原生视口。
  来源面板已关闭时不得回退操作其它面板；`terminal/restored` 与标签菜单
  不提供入口。
- 已在底部或无历史时可重复执行；回看历史时新增输出仍保留阅读位置，显式
  回到底部后跟随新输出。使用原生行为，不新增滚动状态广播或宿主偏移量。
- 不向 TUI 注入 `End` 或其它按键，不解析 Codex / Droid 的内部历史页。
  命令不强制聚焦、不修改增强输入草稿或附件；composer 中 `Cmd+↓` /
  `Cmd+End` 保留文本编辑语义，包括空草稿。
- 成功使用视口变化反馈，不加 toast。原生失败与 IPC rejection 均经
  `showAppAlert` 显示一次错误详情，不重试其它面板。

## 明确不做

- 不撤回 `197029de`、不复活 `TerminalScrollbarOverlayView` / `scroll_page_lines`
- 不改 composer 提及菜单抢箭头、非空草稿不透传
- 不把 `Cmd+↑↓` 改成滚一行；不把裸 ↑↓ 绑成 `jump_to_prompt`
- 不改滚轮 / 拖拇指 / overlay scroller 外观
- 不把 `scroll-to-bottom` 做成用户设置；不整表关掉 `keystroke`

## 检查点

- `tests/unit/native/terminal-viewport-key-ownership-governance.test.ts`
- `tests/unit/native/terminal-key-routing.test.ts`
- `tests/unit/native/terminal-state-invariants.test.ts`（overlay / `scroll_page_lines` 禁止项）
- `tests/unit/renderer/terminal/composer-passthrough.test.ts`
- `tests/unit/renderer/terminal/scroll-to-bottom/actions.test.ts`
- `tests/unit/main/terminal/operations/scroll-to-bottom.test.ts`
- `native/Tests/GhosttyBridgeTests/TerminalViewportKeyOwnershipTests.swift`
- `native/Tests/GhosttyBridgeTests/TerminalDefaultAppearanceConfigTests.swift`
- `native/Tests/GhosttyBridgeTests/TerminalScrollToBottomKeystrokeTests.swift`
- `native/Vendor/libghostty-spm/Patches/ghostty/0109-keystroke-follow-skip-nav-keys.patch`
