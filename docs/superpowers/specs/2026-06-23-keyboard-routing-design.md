# Pier 键盘路由架构设计

> Spec date: 2026-06-23
> Status: design approved, implementation pending
> Author: 不会飞的羊 + Claude (Opus 4.7, via superpowers:brainstorming)

## 背景与问题

Pier 是 Electron + Ghostty native terminal NSView + dockview web overlay 混合架构。macOS NSWindow 只有一个 firstResponder。当 terminal NSView 持有 firstResponder 时，Ghostty 吞掉所有 keystroke，导致 web 层（全局快捷键 / 命令面板 nav key / dialog 输入）失效。

已知 / 推断的 keyboard 路由 bug:

1. ~~已修~~ Cmd+T 等全局快捷键在 terminal focus 时不生效（iter2 P0c — swift NSEvent monitor 拦截 Cmd+key + IPC forward）
2. **当前 bug** Cmd+Shift+P 打开命令面板后 ↑/↓ Enter Esc 等 nav key 不生效（firstResponder 仍是 terminal，Ghostty 吞掉）
3. **推断 bug** 命令面板内 Cmd+A 全选 / Cmd+C 复制 / Cmd+V 粘贴 — swift monitor 当前拦截所有 Cmd+key 消费，dialog input 接不到
4. **未来 bug** file-explorer / settings 等 web panel kit active 时 — firstResponder 仍是 terminal，web panel 内输入 / 快捷键无效

## 设计原则

- **状态机驱动**：firstResponder 跟随 `activePanelKind` + `overlayCount` 两个独立 state 派生的 `inTerminalMode` boolean
- **Scoped keybindings**：keybinding 绑 scope（`global` / `panel:<kind>` / `overlay:<id>`），resolve 按 [overlay 阻断] > [panel 含 fall-through] > [global] 优先级
- **Web 是 source of truth**：所有 active panel / overlay state 在 web 端维护，通过 IPC 通知 swift。swift 不主动决策，只执行 firstResponder swap
- **零额外 IPC 开销**：terminal mode 普通 keystroke 不走 IPC（pass through 给 Ghostty 接），只 Cmd+key 走 IPC forward
- **覆盖未来 panel kit**：新加 panel kit 只需在 panel-registry 声明 `kind: 'terminal' | 'web'`，scope 配 `panel:<component>` 绑 keybinding 即可

## 架构总览

### 状态 → firstResponder 派生

```
Web 端 (dockview state)              Swift 端 (GhosttyBridge)
─────────────────────                ────────────────────────
activePanelKind: 'terminal' | 'web'  ┐
overlayStack: string[]               ├──► inTerminalMode: Bool
                                     │    = activePanelKind=='terminal'
                                     │      && overlayStack.length==0
                                     ┘
                                          ↓
                                     firstResponder:
                                     - inTerminalMode=true  → terminalView(activePanelId)
                                     - inTerminalMode=false → WKWebView
```

### Keyboard 事件流

**inTerminalMode=true** (terminal panel active, 无 overlay):
```
物理 key → NSWindow → firstResponder=Ghostty TerminalView
              ↓
          NSEvent monitor (在 firstResponder dispatch 前)
              ↓
          含 Cmd? ──yes──► forwardCmdKeyCallback → IPC → 路径 2
              │                                          ↓
              no                              registry.resolve(chord, scope)
              ↓                               scope: { activePanel: 'terminal' }
          pass through                        chain: [panel:terminal] → [global]
              ↓                                          ↓
          Ghostty 接 key                              run action
```

**inTerminalMode=false** (web panel active OR overlay active):
```
物理 key → NSWindow → firstResponder=WKWebView → web DOM
              ↓
          NSEvent monitor 检测 inTerminalMode=false → 全 pass through
              ↓
          web 收 DOM keydown → 路径 1 → registry.resolve(chord, scope)
              ↓
          scope: { overlay: 'overlay:command-palette' } 或 { panel: 'web-kind' }
          chain:
            - overlay active → only overlay scope (阻断 global)
            - 否则           → panel scope → global fall-through
              ↓
          有 action: run; 没有: 放给 DOM (cmdk Input / web 输入框 etc)
```

## Swift State Machine 详设

### State

```swift
enum PanelKind { case terminal, web }

struct WindowKeyboardState {
    var activePanelKind: PanelKind = .web   // boot 默认 web 安全
    var activeTerminalPanelId: String?
    var overlayCount: Int = 0

    var inTerminalMode: Bool {
        activePanelKind == .terminal && overlayCount == 0
    }
}

private var windowStates: [ObjectIdentifier: WindowKeyboardState] = [:]
```

### State 转换

| IPC | swift 动作 |
|---|---|
| `setActivePanelKind(windowId, .terminal, panelId)` | state.activePanelKind=.terminal, activeTerminalPanelId=panelId, applyFirstResponder() |
| `setActivePanelKind(windowId, .web, nil)` | state.activePanelKind=.web, activeTerminalPanelId=nil, applyFirstResponder() |
| `setOverlayActive(active)` | state.overlayCount += active ? 1 : -1, applyFirstResponder() |

### applyFirstResponder 核心

```swift
func applyFirstResponder(for window: NSWindow) {
    guard let state = windowStates[ObjectIdentifier(window)] else { return }

    if state.inTerminalMode {
        if let panelId = state.activeTerminalPanelId,
           let term = terminals[panelId] {
            window.makeFirstResponder(term.terminalView)
        }
        // 没找到 terminal NSView → 不动 firstResponder (保留 default WKWebView)
    } else {
        if let wk = findWKWebView(in: window) {
            window.makeFirstResponder(wk)
        }
    }
}
```

**不用 savedFirstResponder restore 模型**：active panel 可能在 overlay 期间被切换，pop overlay 后恢复"之前"firstResponder 不一定对（旧 panel 可能已 close）。按当前 state 重算更可靠。

### NSEvent monitor 行为修改

```swift
private func routeKeyDown(_ event: NSEvent) -> NSEvent? {
    guard let window = ownerWindow, event.window === window else { return event }
    let state = GhosttyBridgeImpl.shared.stateFor(window: window)

    // Web mode: 全 pass through (firstResponder 已 swap 到 WKWebView)
    guard state.inTerminalMode else { return event }

    // Terminal mode: 只拦截 Cmd+key forward
    let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard mods.contains(.command) else { return event }
    guard let chars = event.charactersIgnoringModifiers, !chars.isEmpty else { return event }
    EventRouterView.forwardCmdKeyCallback?(browserWindowId, mods.rawValue, chars)
    return nil
}
```

### Edge cases

| 触发 | dockview event | web IPC | swift state | firstResponder |
|---|---|---|---|---|
| tab1 (terminal) → tab2 (web) | onDidActivePanelChange | setActivePanelKind('web') | activePanelKind=.web | WKWebView |
| tab2 (web) → tab1 (terminal) | onDidActivePanelChange | setActivePanelKind('terminal', id) | activePanelKind=.terminal | terminalView |
| terminal panel 创建 (首次) | onDidAddPanel + 是 active | setActivePanelKind('terminal', id) | activeTerminalPanelId=id | terminalView (但 swift createTerminal 完成才能 swap, 见反例 6) |
| terminal panel close (其他变 active) | onDidActivePanelChange | setActivePanelKind(新 kind) | 同步 | swap |
| overlay open | command-palette mount | overlayCount++ | inTerminalMode=false | WKWebView |
| overlay close | command-palette unmount | overlayCount-- | inTerminalMode 重算 | by activePanelKind |
| 多窗口 | per-window IPC routing | windowStates per ObjectIdentifier | 隔离 | per window |

## Web 端 Scope Registry + IPC 合约

### KeybindingRegistry 扩展

```typescript
type KeybindingScope = 'global' | `panel:${string}` | `overlay:${string}`

interface KeybindingInput {
  commandId: string
  keys: string
  scope?: KeybindingScope   // default 'global'
}

// DEFAULT_KEYMAP
[
  { commandId: 'pier.panel.newTab',        keys: 'Mod+KeyT',        scope: 'global' },
  { commandId: 'pier.panel.closeActive',   keys: 'Mod+KeyW',        scope: 'global' },
  { commandId: 'pier.window.newWindow',    keys: 'Mod+KeyN',        scope: 'global' },
  { commandId: 'pier.panel.newTerminal',   keys: 'Mod+Backquote',   scope: 'global' },
  { commandId: 'pier.commandPalette.toggle', keys: 'Mod+Shift+KeyP', scope: 'global' },
  { commandId: 'pier.settings.open',       keys: 'Mod+Comma',       scope: 'global' },
]
```

### Active Scope Store (新增)

```typescript
// stores/keybinding-scope.store.ts
interface KeybindingScopeState {
  activePanelKind: 'terminal' | 'web' | null
  activePanelComponent: string | null
  overlayStack: string[]

  setActivePanel(kind, component, panelId): void
  pushOverlay(id): void
  popOverlay(id): void
}
```

**overlayStack 替代 overlayCount**：能支持 nested overlay + 知道当前 top overlay scope。

### Resolve 优先级

```typescript
function resolve(chord, scope) {
  const topOverlay = scope.overlayStack.at(-1)
  if (topOverlay) {
    return registry.findInScope(chord, topOverlay) ?? null  // 阻断
  }
  if (scope.activePanelComponent) {
    const hit = registry.findInScope(chord, `panel:${scope.activePanelComponent}`)
    if (hit) return hit
  }
  return registry.findInScope(chord, 'global')
}
```

**"overlay 阻断式" 仅限 Pier registry 内的 binding**：当 overlay active 时，Pier keybinding registry 不让 chord fall through 到 panel/global scope。但 **macOS 原生 key handling**（Cmd+A 全选 / Cmd+C 复制 / Cmd+V 粘贴 / Cmd+X 剪切 / Cmd+Z 撤销）由 WKWebView 自己处理，**不经过 Pier registry**。当 firstResponder=WKWebView 时 web DOM input 自然接 macOS 系统级文字编辑快捷键（IBeam 行为）。

具体路径:
- 用户在命令面板 input 内按 Cmd+A → DOM keydown 触发
- useKeyboardShortcuts 路径 1 capture phase 收到 → `pickAction(Cmd+A, scope={overlay:'overlay:command-palette'})` → registry 内未注册 Cmd+A → 返回 null → **不 preventDefault**
- 事件继续冒泡 → cmdk Input element 收到 → macOS 原生 selectAll IBeam 行为触发 → 输入框内文字全选 ✓

### Panel Kind Metadata

```typescript
// panel-registry.ts
export const panelKinds = {
  terminal: { kind: 'terminal' },
  welcome:  { kind: 'web' },
} as const

export function panelKindOf(component: string): 'terminal' | 'web' {
  return panelKinds[component as keyof typeof panelKinds]?.kind ?? 'web'
}
```

未知 panel default 'web' 保守 — 让 web 接 key 比让 terminal 抢 firstResponder 安全。

### Workspace-host onDidActivePanelChange Listener

```typescript
event.api.onDidActivePanelChange((panel) => {
  if (!panel) {
    scopeStore.setActivePanel('web', null, null)
    window.pier.terminal.setActivePanelKind('web', null)
    return
  }
  const component = panel.view.contentComponent
  const kind = panelKindOf(component)
  scopeStore.setActivePanel(kind, component, panel.id)
  window.pier.terminal.setActivePanelKind(kind, panel.id)
})
```

### IPC 合约

| IPC channel | direction | payload | swift 端 |
|---|---|---|---|
| `pier:terminal:set-active-panel-kind` (新) | renderer → main | `{ kind: 'terminal'\|'web', panelId: string\|null }` | windowState 更新 + applyFirstResponder |
| `pier:terminal:set-overlay` (扩展) | renderer → main | `active: boolean` | overlayCount ±1 + applyFirstResponder |
| `pier:keybinding:forward` (已有) | main → renderer | `{ browserWindowId, modifierFlags, chars }` | 不变 |

### useKeyboardShortcuts 双路径（不变，但 pickAction 拿 scope）

```typescript
// 路径 1: web mode 工作 — DOM keydown capture
window.addEventListener('keydown', (e) => {
  if (isImePending(e)) return
  const action = pickAction(chordFromEvent(e), e.target, scopeStore.getState())
  if (action) { e.preventDefault(); e.stopPropagation(); runAction(action) }
}, true)

// 路径 2: terminal mode 工作 — IPC chord forward
window.pier.keybinding.onForward(({ modifierFlags, chars }) => {
  const chord = chordFromNativeForward(modifierFlags, chars)
  const action = pickAction(chord, null, scopeStore.getState())
  if (action) runAction(action)
})
```

### Command-palette mount/unmount

```typescript
useEffect(() => {
  if (!isOpen) return
  scopeStore.getState().pushOverlay('command-palette')
  pushOverlay()  // 已有, 触发 swift setOverlayActive(true) → applyFirstResponder
  return () => {
    scopeStore.getState().popOverlay('command-palette')
    popOverlay()
  }
}, [isOpen])
```

## 迁移路径（5 步分批上线）

| Step | 改动 | 风险 | 验证 |
|---|---|---|---|
| 1 | swift `WindowKeyboardState` 结构 + IPC `setActivePanelKind` skeleton (state 更新, 不调 applyFirstResponder) | 0 | typecheck + native rebuild |
| 2 | `applyFirstResponder` 实现 + 替换 `focus(panelId:)` 内 makeFirstResponder 为更新 activeTerminalPanelId（行为等价于现状） | Low | terminal 普通输入正常 |
| 3 | `setOverlayActive` 也触发 applyFirstResponder + `routeKeyDown` 加 inTerminalMode gate + `createTerminal` 完成后补 applyFirstResponder（修反例 6） | Medium — 路由核心点 | Cmd+Shift+P 后 ↑/↓/Enter/Esc/Cmd+A 全工作 |
| 4 | web 端 panel-registry `panelKindOf` + keybinding-scope.store + workspace-host onDidActivePanelChange listener | Low | tab 切换 console 看 scope 变化 |
| 5 | keybinding registry 加 scope 字段 + resolve 按 chain + DEFAULT_KEYMAP 全标 `scope: 'global'`（行为等价） | Low | 所有 Cmd+T/W/N/` 仍工作 |

## 测试 Matrix

### Terminal mode (T)
- T1 普通字符输入（`ls`）→ shell 接
- T2 中文 IME → Ghostty IME composition 工作
- T3 Ctrl+C → SIGINT 中断
- T4 Tab 补全 → shell 接
- T5 ↑/↓ shell history → shell 接

### Global shortcuts (G)
- G1 Cmd+T → newTab
- G2 Cmd+Shift+P → 命令面板打开
- G3 Cmd+W → 关 panel
- G4 Cmd+` → newTerminal
- G5 Cmd+N → 新窗口
- G6 Cmd+Comma → 设置

### Overlay (O)
- O1 ↑/↓ → cmdk navigate
- O2 Enter → cmdk select
- O3 Esc → 关闭
- O4 **Cmd+T** → **inert（不触发 global，按 brainstorm Q1 选项 B）**
- O5 Cmd+A → 输入框全选（macOS 原生 IBeam 行为）
- O6 Cmd+C/V → 复制粘贴

### Web panel (W)
- W1 字符 key → web DOM 接
- W2 Cmd+T → newTab fall through global

### Tab 切换 (TS)
- TS1 tab1 (terminal) → tab2 (web): firstResponder swap WKWebView，字符不入 terminal
- TS2 tab2 (web) → tab1 (terminal): firstResponder swap terminalView，字符入 terminal
- TS3 terminal panel close 触发新 active: firstResponder 跟 active panel 类型

### 多窗口 (M)
- M1 window-A terminal + window-B web，window-B Cmd+T → 新 tab 在 window-B
- M2 window-A overlay + window-B terminal，window-B Cmd+T 仍工作

### Future panel scope (P)
- P1 panel:file-explorer Cmd+S → search action (panel scope)
- P2 panel:file-explorer Cmd+T → fall through global → newTab

## 反例分析

### 反例 1: race 切 tab
用户极快连续 tab1→tab2→tab1，三次 IPC 顺序到达。swift 按序处理，最终 state 与 dockview 一致，中间瞬态 NSView swap 无可见副作用。**可接受**。

### 反例 2: overlay close 时 active panel 已变
命令面板内做了某个 action 切 panel，再 Esc 关命令面板。pop overlay 时 swift state 的 activePanelKind 已被 setActivePanelKind 同步过。applyFirstResponder 按当前 state 重算 → 正确。**这是设计上不用 savedFirstResponder restore 模型的原因**。

### 反例 3: nested overlay
命令面板内触发 quick-pick 二级面板。overlayStack push `'overlay:quick-pick'` 在 `'overlay:command-palette'` 之上，pop 时栈自动恢复。**已支持**。

### 反例 4: panel kind 未声明
第三方 panel kit 没在 panel-registry 注册。`panelKindOf()` 返回 'web' (default)。保守安全。

### 反例 5: 首次启动
app boot → applyDefaultLayout 创建 terminal panel → dockview auto-active → onDidActivePanelChange fire → IPC → swift applyFirstResponder → makeFirstResponder(terminalView)。**正常**（前提是 swift `terminals` dict 已有该 panel，见反例 6）。

### 反例 6: terminal panel 在 swift create 前 web 已发 active
dockview onDidActivePanelChange 早于 React TerminalPanel useEffect 调 `terminal.create`。此时 `terminals[panelId]` 是 nil → applyFirstResponder 跳过 makeFirstResponder（保留 WKWebView 默认）。`terminal.create` 完成后 dockview 不会再 fire active change。**风险**：terminal 显示但 firstResponder 不是它。

**修复**：swift `createTerminal` 成功后检查 `if state.activeTerminalPanelId == panelId { applyFirstResponder(for: parent) }`，补一次 swap。已纳入迁移 step 3。

## 不实现的内容（YAGNI）

- VS Code boolean expression `when` clause（按 brainstorm Q3 选项 A，flat scope tag 够用）
- `globalShortcut` API 全 OS 级注册（Pier 只要窗口级行为）
- `before-input-event` 拦截（firstResponder 已切到 WKWebView，DOM keydown 自然接，不需要 main 拦截）
- savedFirstResponder restore（按 state 重算更可靠，见反例 2）

## 不再使用的旧代码

- `GhosttyBridgeImpl.focus(panelId:)` 内部 `terminalView.window?.makeFirstResponder(terminalView)` — 移除（被 applyFirstResponder 取代）
- `terminal-overlay.store.ts` overlayCount → 由 scope store overlayStack 替代（兼容 push/pop API 但内部用 stack）

## 实现优先级建议

按迁移 step 顺序，每 step 单独 PR / commit，验证后再下一步。
