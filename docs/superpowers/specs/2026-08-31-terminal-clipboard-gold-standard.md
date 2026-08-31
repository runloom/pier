# 终端剪贴板金标准

日期：2026-08-31
状态：现行权威
范围：ghostty 剪贴板回调（write / read / confirm）的宿主路由、空串防御、composer 发送期的剪贴板图片抑制恢复、⌘C/⌘V responder 动作门禁。
不包含：粘贴确认 NSAlert 生命周期（见 `ghostty-host-copy.ts` 头注释与 `ClipboardConfirmRequest.swift`）、renderer 上下文菜单复制（`read-selection-text` + 菜单 `clipboardText`，不经本文回调）。

背景缺陷：Pier 曾把 ghostty 的 selection 剪贴板与 standard 剪贴板都写进
`NSPasteboard.general`。ghostty 在 macOS 默认 `copy-on-select = true`，于是任何终端里的
任何选区变化（含切窗口时点击终端顺带的微拖、双击空白）都会静默覆盖系统剪贴板；
空白选区经 `clipboard-trim-trailing-spaces` 修剪后是空串，直接清空系统剪贴板 ——
表现为「一个 tab 复制、另一个窗口粘贴偶现为空」。

## 一句话终态

只有 standard 剪贴板允许触碰系统剪贴板；selection 剪贴板住在私有 named pasteboard；
空串与未确认的写入一律拒绝；任何全局剪贴板的「先改后还」必须在还原前验证窗口期
没有其他写入者；显式的复制/粘贴命令永不静默丢弃。

## 种类路由（对齐 Ghostty.app）

单一来源：`GhosttyTerminal/Host/ClipboardRouting.swift`。

| ghostty 种类 | 写目标 | 读来源 |
|---|---|---|
| `GHOSTTY_CLIPBOARD_STANDARD`（⌘C 复制、⌘V 粘贴、OSC 52 `c`） | `NSPasteboard.general` | general（文本 → 图片物化兜底） |
| `GHOSTTY_CLIPBOARD_SELECTION`（copy-on-select、中键粘贴、OSC 52 `s`） | 私有 `io.pier.app.terminal.selection` | 私有（仅文本，无图片兜底） |
| 其他（zig `primary = 2` / OSC 52 `p`、未来新增值） | **拒绝**（fail-closed，写日志） | **拒绝**（返回 false） |

- **未知种类 fail-closed**：C 头文件只命名 STANDARD / SELECTION，但 zig 侧
  `apprt.Clipboard` 有 `primary = 2`（OSC 52 `p`），且 embedded 层按
  `supports_selection_clipboard` 放行 primary 请求——raw 值会真实到达回调。
  `TerminalClipboardKind` 是 failable init，未知值返回 nil；禁止「非 selection
  即 standard」的 fail-open 映射（那会让 OSC 52 `p` 重新劫持系统剪贴板）。
  Ghostty.app 同样丢弃未知种类（`NSPasteboard.ghostty(_:)` 返回 nil）。
- `supports_selection_clipboard = true` 必须保持：改为 false 时 ghostty 的
  `copy-on-select = true` 会 fallback 直写 standard（比缺陷更糟）。
- 私有 pasteboard 用计算属性取 wrapper（Swift 6 并发约束）；状态在系统
  pasteboard server 侧，按名字稳定。
- 中键粘贴语义随之对齐 Ghostty.app：贴「最近一次选区」，不是系统剪贴板。

## 写入防御

`writeClipboard` 按序执行四道守卫，全部命中 `TerminalDebugLog(.input)`：

1. **未知种类拒绝**（failable init，见路由表）。
2. **confirm fail-closed**：`confirm=true`（`clipboard-write = ask`）而 Pier 无
   authorize-copy UI（`ClipboardConfirmAlert` 只做 paste-protection，OSC 52 写
   不经 `confirm_read_clipboard`）→ 拒绝写入。Pier 生成的 config 不改
   clipboard-write（默认 allow），此路径正常不可达，但不得静默放行未确认写入。
3. **空串拒绝仅限 standard**（`TerminalClipboardWritePolicy.shouldWrite(_:to:)`）：
   空 string flavor 在读侧等价「无内容」，空白选区、OSC 52 空载荷不得清空
   **系统剪贴板**；私有 selection 板**接受空写**——空白选区必须能清掉陈旧的
   中键粘贴内容（对齐 Ghostty.app 对 selection 种类的透写）。
4. 路由后才 `clearContents()` + `setString`。

读侧空串视为无内容（`$0.isEmpty ? nil : $0`，AppKit / UIKit 同构）；standard
读保持「文本优先、图片物化兜底」的顺序（截图只会出现在系统剪贴板上）。

## 抑制恢复纪律（clipboard-image-suppress）

剪贴板是全局资源。`beginClipboardImageSuppress` 把板置为 text-only 快照；
`endClipboardImageSuppress` 还原前必须验证窗口期无其他写入者：

- 文本 ≠ 快照文本，或出现新光栅 → 有人写过（用户 ⌘C / OSC 52）→ **保留新内容，
  放弃还原**。
- 未变且快照带图 → 还原图+文；未变且无图 → 板上已是终态，不做冗余回写。
- **已知残留（不可判定，如实记录）**：窗口期写入与快照**完全相同的文本**
  无法区分（Electron 不暴露 changeCount）——此时仍会还原快照；若快照带图，
  等于给同文本剪贴板重新挂回旧截图，并丢弃该次写入的富文本 flavor。禁止在
  文档或注释中声称此还原「无害」。根治路径：经 native 侧暴露
  `NSPasteboard.changeCount` 作写入者判定（后续项）。

## Responder 动作不吞键

`copy(_:)` / `paste(_:)` / `selectAll(_:)` 是单派发显式命令（Edit 菜单 role、
选区右键菜单）：AppKit 把每个 action 派发给 key window 响应链上**恰好一个**
responder，被终端处理即意味着 web 侧没有处理 —— **禁止用 `hostKeyboardActive`
做门禁**：转场帧里该标志落后于 first responder，门禁会把用户的复制/粘贴静默
吞掉。**已接受的权衡**：若出现「first responder 滞留终端、键盘逻辑归 web」的
状态，Edit 菜单动作会落在终端上——显式命令被执行优于被静默丢弃；Pier 的 web
浮层（命令面板 / composer / 通知 popover）经 DOM focus / `requestTerminalWebFocus`
把 first responder 移交 Chromium，正常不会出现该状态。环境键事件（`keyDown` /
`keyUp` / `flagsChanged` / `performKeyEquivalent` / `doCommand`）与 web 浮层键盘
归属存在真实竞态，门禁必须保留。

## 检查点

- `tests/unit/native/terminal-clipboard-routing.test.ts`（路由 / 未知种类
  fail-closed / 空串策略作用域 / confirm / responder 门禁）
- `native/Tests/GhosttyBridgeTests/TerminalClipboardRoutingTests.swift`（种类映射
  与 failable init；**行为测试**直接驱动真 `TerminalCallbacks.writeClipboard`：
  selection 写不动 general changeCount、空 selection 写清陈旧选区、未知种类 /
  confirm=true / 空 standard 写均不触碰任何 pasteboard）
- `tests/unit/main/preferences/clipboard-image-suppress.test.ts`（窗口期变更保留、
  无冗余回写）
- `tests/unit/native/terminal-clipboard-image-paste.test.ts`（既有：图片物化兜底
  顺序不回退）

排查工具：`PIER_TERMINAL_DEBUG_LOG=1` 下写/读/跳过/拒绝均有 input 通道日志
（kind + bytes + lines）。
