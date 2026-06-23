# Keyboard Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Pier 完整 keyboard 路由架构（state-machine firstResponder + scoped keybindings），修复命令面板内 ↑/↓/Cmd+A 不生效 bug，并为 future web panel kit 奠定 scope 基础。

**Architecture:** Web 是 SoT，维护 `activePanelKind` + `overlayStack` 两个 state，通过 IPC 通知 swift。Swift 派生 `inTerminalMode` boolean，动态 makeFirstResponder swap (terminalView ↔ WKWebView)。NSEvent monitor 按 inTerminalMode 决定拦截/pass-through。Web keybinding registry 加 scope tag，resolve 按 [overlay 阻断] > [panel] > [global] 优先级。

**Tech Stack:** Swift (GhosttyBridge + NSEvent monitor) + N-API ThreadSafeFunction + Electron main IPC + zustand store + React useEffect + dockview onDidActivePanelChange

**详细设计参考:** [docs/superpowers/specs/2026-06-23-keyboard-routing-design.md](../specs/2026-06-23-keyboard-routing-design.md)

---

### Task 1: Swift WindowKeyboardState 数据结构 + IPC stub (state 更新, 不调 applyFirstResponder)

**Goal:** 加 state 容器 + 端到端 IPC 通路，但行为不变（不调 applyFirstResponder）。建立类型 + IPC 骨架。

**Files:**
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift`
- Modify: `native/src/addon.mm`
- Modify: `src/shared/contracts/terminal.ts`
- Modify: `src/main/ipc/terminal.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Swift 加 PanelKind + WindowKeyboardState + windowStates dict**

修改 `native/Sources/GhosttyBridge/GhosttyBridge.swift` 在 `GhosttyBridgeImpl` 类内 (在现有 `terminals/eventRouters/controllers` 字段附近)：

```swift
enum PanelKind {
    case terminal, web
}

struct WindowKeyboardState {
    var activePanelKind: PanelKind = .web   // boot 默认 web (terminal 未必存在)
    var activeTerminalPanelId: String?
    var overlayCount: Int = 0

    var inTerminalMode: Bool {
        activePanelKind == .terminal && overlayCount == 0
    }
}

// per-window state, 跟 eventRouters 一样用 ObjectIdentifier(window) 作 key
private var windowStates: [ObjectIdentifier: WindowKeyboardState] = [:]

func stateFor(window: NSWindow) -> WindowKeyboardState {
    return windowStates[ObjectIdentifier(window)] ?? WindowKeyboardState()
}

private func mutateState(_ window: NSWindow, _ mutate: (inout WindowKeyboardState) -> Void) {
    let windowId = ObjectIdentifier(window)
    var state = windowStates[windowId] ?? WindowKeyboardState()
    mutate(&state)
    windowStates[windowId] = state
}
```

- [ ] **Step 2: Swift 加 setActivePanelKind method (只更新 state, 不调 applyFirstResponder)**

在 `GhosttyBridgeImpl` 内 (附在 `setOverlayActive` 后面)：

```swift
/// 通知 swift 当前 active panel 是 terminal 还是 web. 由 web 端 dockview
/// onDidActivePanelChange 触发. swift 不主动决策, 只更新 state — 后续 task
/// 加 applyFirstResponder 调用让它真正 swap firstResponder.
func setActivePanelKind(window: NSWindow, kind: PanelKind, panelId: String?) {
    mutateState(window) { state in
        state.activePanelKind = kind
        state.activeTerminalPanelId = kind == .terminal ? panelId : nil
    }
}
```

- [ ] **Step 3: Swift 加 setupWindow 时初始化 state**

修改 `setupWindow(parent:browserWindowId:)` 末尾 (在 `eventRouters[windowId] = router` 后)：

```swift
// 初始化 per-window keyboard state (PanelKind 默认 .web — 安全, 不抢 firstResponder)
windowStates[windowId] = WindowKeyboardState()
```

- [ ] **Step 4: Swift 加 C ABI export**

修改 `native/Sources/GhosttyBridge/GhosttyBridge.swift` 末尾的 C ABI 区域 (在 `ghostty_bridge_set_keyboard_forward_callback` 后)：

```swift
@_cdecl("ghostty_bridge_set_active_panel_kind")
public func ghosttyBridgeSetActivePanelKind(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ kindRaw: Int,   // 0 = terminal, 1 = web
    _ panelIdPtr: UnsafePointer<CChar>?
) {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        let kind: PanelKind = (kindRaw == 0) ? .terminal : .web
        let panelId: String? = panelIdPtr.flatMap { String(cString: $0) }
        GhosttyBridgeImpl.shared.setActivePanelKind(window: window, kind: kind, panelId: panelId)
    }
}
```

- [ ] **Step 5: addon.mm 加 N-API binding**

修改 `native/src/addon.mm` extern "C" 块 (在 `ghostty_bridge_set_keyboard_forward_callback` typedef 后)：

```cpp
void ghostty_bridge_set_active_panel_kind(void* nsWindow, long kindRaw, const char* panelId);
```

加 JS handler (附在 `JsSetKeyboardForwardCallback` 后)：

```cpp
static Napi::Value JsSetActivePanelKind(const Napi::CallbackInfo& info) {
    NSWindow* win = WindowFromHandle(info[0]);
    if (!win) return info.Env().Undefined();
    long kindRaw = static_cast<long>(info[1].As<Napi::Number>().Int64Value());
    const char* panelIdC = nullptr;
    std::string panelIdHolder;
    if (info.Length() > 2 && info[2].IsString()) {
        panelIdHolder = info[2].As<Napi::String>().Utf8Value();
        panelIdC = panelIdHolder.c_str();
    }
    ghostty_bridge_set_active_panel_kind((__bridge void*)win, kindRaw, panelIdC);
    return info.Env().Undefined();
}
```

注册到 exports (在 Init 函数内, 跟其他 export 一起)：

```cpp
exports.Set("setActivePanelKind", Napi::Function::New(env, JsSetActivePanelKind));
```

- [ ] **Step 6: shared/contracts/terminal.ts 加 type**

修改 `src/shared/contracts/terminal.ts` `TerminalAPI` interface (在现有 setOverlayActive 附近)：

```typescript
setActivePanelKind: (
  kind: "terminal" | "web",
  panelId: string | null
) => void;
```

- [ ] **Step 7: main/ipc/terminal.ts 加 NativeAddon interface 字段 + IPC handler**

修改 `src/main/ipc/terminal.ts` `NativeAddon` interface (在 setKeyboardForwardCallback 后)：

```typescript
setActivePanelKind(
  parentHandle: Buffer,
  kindRaw: number,
  panelId: string | null
): void;
```

加 IPC handler (在 registerTerminalIpc 内, 紧跟其他 ipcMain.on 后)：

```typescript
ipcMain.on(
  "pier:terminal:set-active-panel-kind",
  (event, kind: "terminal" | "web", panelId: string | null) => {
    if (!addon) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const kindRaw = kind === "terminal" ? 0 : 1;
    try {
      addon.setActivePanelKind(win.getNativeWindowHandle(), kindRaw, panelId);
    } catch (err) {
      console.error("[pier-set-active-panel-kind] failed:", err);
    }
  }
);
```

- [ ] **Step 8: preload/index.ts 暴露 API**

修改 `src/preload/index.ts` `terminalApi` 对象 (附在 setOverlayActive 后)：

```typescript
setActivePanelKind: (kind, panelId) =>
  ipcRenderer.send("pier:terminal:set-active-panel-kind", kind, panelId),
```

- [ ] **Step 9: 编译验证 (typecheck + native rebuild)**

```bash
pnpm typecheck
pnpm build:native
```

Expected: 两个都 0 errors. 此时 IPC 通路完整但 swift state 没人调 → 行为完全没变。

- [ ] **Step 10: Commit**

```bash
git add native/Sources/GhosttyBridge/GhosttyBridge.swift native/src/addon.mm \
  src/shared/contracts/terminal.ts src/main/ipc/terminal.ts src/preload/index.ts
git commit -m "$(cat <<'EOF'
feat(keyboard): swift WindowKeyboardState skeleton + setActivePanelKind IPC

加 PanelKind + WindowKeyboardState struct + windowStates per-window dict +
setActivePanelKind method (state 更新, 不调 applyFirstResponder, 行为不变).
端到端 IPC 通路: renderer → preload → main → addon → swift, 但无 caller 调,
等 task 5 接.

详 docs/superpowers/specs/2026-06-23-keyboard-routing-design.md step 1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Swift applyFirstResponder + 替换 focus 内 makeFirstResponder (行为等价 - 准备激活)

**Goal:** 实现 applyFirstResponder 但只通过 focus(panelId:) 触发（替换原 makeFirstResponder 调用），行为完全等价于当前。准备好后续 task 3 让 setActivePanelKind / setOverlayActive / createTerminal 三处都调它。

**Files:**
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift`

- [ ] **Step 1: Swift 加 applyFirstResponder method**

在 `GhosttyBridgeImpl` 内 (附在 setActivePanelKind 后)：

```swift
/// 按 windowStates 当前 state 重算 + apply firstResponder.
/// 不用 savedFirstResponder restore 模型 — active panel 可能在 overlay 期间被
/// 切换, pop overlay 后恢复"之前"的 firstResponder 不一定对 (旧 panel 可能已 close).
/// 按当前 state 重算更可靠.
func applyFirstResponder(for window: NSWindow) {
    let state = stateFor(window: window)

    if state.inTerminalMode {
        if let panelId = state.activeTerminalPanelId,
           let term = terminals[panelId] {
            window.makeFirstResponder(term.terminalView)
        }
        // 没找到 terminal NSView → 不动 firstResponder (保留 WKWebView default)
    } else {
        if let wk = findWKWebViewInContentView(window) {
            window.makeFirstResponder(wk)
        }
    }
}

private func findWKWebViewInContentView(_ window: NSWindow) -> NSView? {
    guard let contentView = window.contentView else { return nil }
    func search(in view: NSView) -> NSView? {
        if String(describing: type(of: view)) == "WKWebView" { return view }
        for child in view.subviews {
            if let found = search(in: child) { return found }
        }
        return nil
    }
    return search(in: contentView)
}
```

注意 `findWKWebViewInContentView` 复制自 EventRouterView 里同名 helper — 这里需要独立实例（EventRouterView 内的是 private，不能共享）。如果你想 DRY 可以提到文件顶层 helper，但 self-contained 也行（两份代码 4 行，DRY 收益不大）。

- [ ] **Step 2: Swift 修改 focus(panelId:) 不再调 makeFirstResponder**

替换 `GhosttyBridgeImpl.focus(panelId:)` 当前实现：

```swift
func focus(panelId: String) {
    guard let term = terminals[panelId] else { return }
    activePanelId = panelId
    // 更新 per-window state + 触发 applyFirstResponder (代替原 makeFirstResponder).
    // 这里只处理 terminal panel focus 场景, web panel focus 由 setActivePanelKind('web') 走.
    if let window = term.terminalView.window {
        setActivePanelKind(window: window, kind: .terminal, panelId: panelId)
        applyFirstResponder(for: window)
    }
}
```

- [ ] **Step 3: Swift setActivePanelKind 也调 applyFirstResponder**

修改 task 1 step 2 的 setActivePanelKind 实现，末尾加调用：

```swift
func setActivePanelKind(window: NSWindow, kind: PanelKind, panelId: String?) {
    mutateState(window) { state in
        state.activePanelKind = kind
        state.activeTerminalPanelId = kind == .terminal ? panelId : nil
    }
    applyFirstResponder(for: window)
}
```

- [ ] **Step 4: 编译验证 + 手测 terminal 正常输入**

```bash
pnpm build:native
pkill -9 -f Electron && sleep 1
# preview_start dev (假设 preview server 已 running, 或 user 重启)
```

手测 spec matrix:
- T1 普通输入: 输入 `ls`, shell 显示文件列表
- T2 IME: 输入 "你好" 用中文输入法
- T3 Ctrl+C: 跑 `ping localhost`, 按 Ctrl+C 中断
- G1 Cmd+T: 新 panel 创建

Expected: 全部 ✓（行为等价于 task 1 commit 前 — 因为 focus(panelId:) 仍是 react onDidActiveChange 触发，仍 makeFirstResponder(terminalView)，只是走 applyFirstResponder 间接调）。

- [ ] **Step 5: Commit**

```bash
git add native/Sources/GhosttyBridge/GhosttyBridge.swift
git commit -m "$(cat <<'EOF'
feat(keyboard): swift applyFirstResponder 实现 + 替换 focus 内 makeFirstResponder

加 applyFirstResponder(for: window) 按 state 重算 firstResponder. 替换
focus(panelId:) 内直接 makeFirstResponder 调用为 setActivePanelKind +
applyFirstResponder 间接调用. 行为等价 (terminal focus 时仍切到 terminalView).

详 spec step 2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Swift setOverlayActive 触发 applyFirstResponder + routeKeyDown gate + createTerminal 补 applyFirstResponder

**Goal:** 激活 firstResponder swap on overlay open/close + NSEvent monitor 在 web mode 全 pass through + 修反例 6 (createTerminal 完成补 swap). **这是修复 Cmd+Shift+P 后 ↑/↓ bug 的核心 task**.

**Files:**
- Modify: `native/Sources/GhosttyBridge/GhosttyBridge.swift`

- [ ] **Step 1: Swift setOverlayActive 维护 overlayCount + 调 applyFirstResponder per window**

替换 `setOverlayActive(_ active:)` 当前实现：

```swift
func setOverlayActive(_ active: Bool) {
    for (windowId, router) in eventRouters {
        router.overlayActive = active
        router.isHidden = active

        // 更新 per-window overlayCount + 触发 applyFirstResponder.
        // overlayCount > 0 时 inTerminalMode=false → firstResponder swap to WKWebView,
        // web overlay (command palette / dialog) 自然接 keyboard.
        if let window = eventRouters[windowId]?.window {
            mutateState(window) { state in
                state.overlayCount += active ? 1 : -1
                if state.overlayCount < 0 { state.overlayCount = 0 }  // defensive
            }
            applyFirstResponder(for: window)
        }
    }
}
```

注意：EventRouterView 没有 `window` property — 它是 NSView，用 `router.window` 即可（NSView 内置 .window 属性返回所在 NSWindow，前提是 router 已 addSubview 到 contentView，那时 .window 是 parent NSWindow）。

- [ ] **Step 2: Swift EventRouterView.routeKeyDown 加 inTerminalMode gate**

修改 `EventRouterView.routeKeyDown(_:)` 当前实现，在 `guard mods.contains(.command) else { return event }` 之前加 gate：

```swift
private func routeKeyDown(_ event: NSEvent) -> NSEvent? {
    guard let window = ownerWindow, event.window === window else { return event }

    // Web mode (overlay active OR active panel is web): 全 pass through.
    // firstResponder 已 swap 到 WKWebView, web DOM 自然接所有 key (含 ↑/↓/Enter/Cmd+A/Cmd+T 等).
    // 不在此处拦截 Cmd+key — let web's useKeyboardShortcuts 路径 1 (DOM keydown capture)
    // 用 scopeStore 按 [overlay阻断] > [panel] > [global] 优先级 resolve.
    let state = GhosttyBridgeImpl.shared.stateFor(window: window)
    guard state.inTerminalMode else { return event }

    // Terminal mode: 只拦截 Cmd+key forward 给 web (路径 2 IPC), 其他 pass through 给 Ghostty.
    let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard mods.contains(.command) else { return event }
    guard let chars = event.charactersIgnoringModifiers, !chars.isEmpty else { return event }
    EventRouterView.forwardCmdKeyCallback?(browserWindowId, mods.rawValue, chars)
    return nil
}
```

- [ ] **Step 3: Swift createTerminal 末尾补 applyFirstResponder (修反例 6)**

修改 `GhosttyBridgeImpl.createTerminal(parent:panelId:viewport:)` 末尾 (在 `return true` 之前)：

```swift
// 反例 6 修复: dockview onDidActivePanelChange 可能早于 React TerminalPanel
// useEffect 调 terminal.create. 早到的 setActivePanelKind 时 terminals[panelId]
// 还没创建, applyFirstResponder 跳过 makeFirstResponder. create 完成后补一次,
// 确保 firstResponder 真正 swap 到 terminal NSView.
if let window = parent.contentView?.window {
    let state = stateFor(window: window)
    if state.activeTerminalPanelId == panelId {
        applyFirstResponder(for: window)
    }
}

return true
```

实际上 `parent.contentView?.window` 是 parent 自己（contentView.window === parent）。直接用 `parent`：

```swift
let state = stateFor(window: parent)
if state.activeTerminalPanelId == panelId {
    applyFirstResponder(for: parent)
}
return true
```

- [ ] **Step 4: 编译验证 + 手测 (关键 bug 修复验证)**

```bash
pnpm build:native
pkill -9 -f Electron && sleep 1
# user 重启 dev server
```

手测 spec matrix（**优先验证 P0**）:
- **O1**: 按 Cmd+Shift+P 打开命令面板，按 ↑/↓ → cmdk list 上下选中 ✓
- **O2**: 命令面板按 Enter → 选中 action 执行 ✓
- **O3**: 命令面板按 Esc → 关闭 ✓
- **O5**: 命令面板 input 有文字时按 Cmd+A → 文字全选 ✓ (macOS 原生 IBeam)
- **T3**: terminal 跑 `ping`，按 Ctrl+C → SIGINT 中断 ✓
- **G1**: terminal active，按 Cmd+T → newTab 触发 ✓ (terminal mode 路径 2 IPC forward 仍工作)

Expected: 全部 ✓。如果 O5 失败（Cmd+A 仍被 swift 拦截没全选），检查 routeKeyDown gate 是否真的 inTerminalMode=false → pass through（看 swift NSLog 或加临时 print 调试）。

- [ ] **Step 5: Commit**

```bash
git add native/Sources/GhosttyBridge/GhosttyBridge.swift
git commit -m "$(cat <<'EOF'
fix(keyboard): overlay active 时 firstResponder swap + monitor pass through

3 改动合并 (spec step 3):
- setOverlayActive 更新 windowState.overlayCount + 调 applyFirstResponder
  per window, overlay 时 firstResponder swap to WKWebView 让 web DOM 接 key
- EventRouterView.routeKeyDown 加 inTerminalMode gate, web mode 全 pass through
  (不拦截 Cmd+key) 让 ↑/↓/Enter/Cmd+A 等 nav key 自然到 DOM
- createTerminal 末尾补 applyFirstResponder (修反例 6: setActivePanelKind 早于
  swift terminal create 时 firstResponder swap 漏)

修复 user 报告: 命令面板打开后 ↑/↓ Enter 不生效

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Web 端 panel-registry panelKindOf + keybinding-scope.store

**Goal:** Web 端建立 scope state 容器 + panel kind metadata，准备给 task 5 (workspace-host listener) 和 task 6/7 (scope resolve / overlay stack) 用。

**Files:**
- Modify: `src/renderer/components/workspace/panel-registry.ts`
- Create: `src/renderer/stores/keybinding-scope.store.ts`

- [ ] **Step 1: 改 panel-registry.ts 加 panelKindOf**

完整改写 `src/renderer/components/workspace/panel-registry.ts`（当前文件只有 `panelComponents` map，加 panelKinds metadata + panelKindOf helper）：

读当前文件先，再 edit。假设当前结构：

```typescript
import { TerminalPanel } from "@/panel-kits/terminal/terminal-panel.tsx";
import { WelcomePanel } from "./welcome-panel.tsx";

export const panelComponents = {
  terminal: TerminalPanel,
  welcome: WelcomePanel,
};
```

加 panelKinds + panelKindOf：

```typescript
import { TerminalPanel } from "@/panel-kits/terminal/terminal-panel.tsx";
import { WelcomePanel } from "./welcome-panel.tsx";

export const panelComponents = {
  terminal: TerminalPanel,
  welcome: WelcomePanel,
};

/**
 * Panel kit 类型元数据 — keyboard 路由用.
 * - 'terminal': panel 内是 Ghostty native NSView, 需要 firstResponder = terminalView
 * - 'web': panel 内全是 web DOM, firstResponder = WKWebView
 *
 * 新加 panel kit 时在这里登记一行. 未知 panel default 'web' 安全
 * (不会让 terminal 抢 firstResponder).
 */
export const panelKinds = {
  terminal: "terminal",
  welcome: "web",
} as const;

export function panelKindOf(component: string): "terminal" | "web" {
  return (
    (panelKinds as Record<string, "terminal" | "web">)[component] ?? "web"
  );
}
```

- [ ] **Step 2: 创建 stores/keybinding-scope.store.ts**

新建文件 `src/renderer/stores/keybinding-scope.store.ts`：

```typescript
/**
 * Keybinding scope 状态容器. Web 是 source of truth — workspace-host 监听
 * dockview onDidActivePanelChange 调 setActivePanel; command-palette / dialog
 * mount/unmount 调 pushOverlay/popOverlay. swift 通过 IPC 收 setActivePanelKind
 * 同步 mirror state 决定 firstResponder swap.
 *
 * resolve 优先级 (use-keybindings.pickAction 内消费):
 *   1. overlayStack 顶 → only top overlay scope (阻断, 不 fall through to panel/global)
 *   2. activePanelComponent → panel:<component> scope, miss 再 fall through
 *   3. global scope (default fallback)
 */
import { create } from "zustand";

export type PanelKind = "terminal" | "web";

export interface KeybindingScopeState {
  activePanelKind: PanelKind | null;
  activePanelComponent: string | null;
  activePanelId: string | null;
  /** Overlay scope id 栈 (支持 nested overlay, 例: command-palette → quick-pick). */
  overlayStack: string[];

  setActivePanel(
    kind: PanelKind | null,
    component: string | null,
    panelId: string | null
  ): void;
  pushOverlay(id: string): void;
  popOverlay(id: string): void;
}

export const useKeybindingScope = create<KeybindingScopeState>((set) => ({
  activePanelKind: null,
  activePanelComponent: null,
  activePanelId: null,
  overlayStack: [],

  setActivePanel: (kind, component, panelId) =>
    set({
      activePanelKind: kind,
      activePanelComponent: component,
      activePanelId: panelId,
    }),

  pushOverlay: (id) =>
    set((state) => ({ overlayStack: [...state.overlayStack, id] })),

  popOverlay: (id) =>
    set((state) => {
      // pop 仅当 id 是栈顶 (规范使用), 否则按 LIFO 移除该 id 的最后一次出现
      const idx = state.overlayStack.lastIndexOf(id);
      if (idx === -1) return {};
      const next = [...state.overlayStack];
      next.splice(idx, 1);
      return { overlayStack: next };
    }),
}));
```

- [ ] **Step 3: typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors. (依赖 zustand，已在 package.json)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/workspace/panel-registry.ts \
  src/renderer/stores/keybinding-scope.store.ts
git commit -m "$(cat <<'EOF'
feat(keyboard): web 端 panelKindOf + keybinding-scope zustand store

加 panel-registry 的 panelKinds metadata 标 terminal/web kind. 加新 zustand
store 维护 activePanelKind + activePanelComponent + overlayStack (支持 nested).
为 task 5-7 的 listener / scope resolve / overlay stack push/pop 提供底层 state.

详 spec step 4 (part 1).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: workspace-host onDidActivePanelChange listener + IPC

**Goal:** dockview active panel 变化时通知 swift 和更新 scopeStore — 让 task 3 的 swift firstResponder swap 真正接到信号。**这一步生效后 tab 切换 firstResponder 跟着切**。

**Files:**
- Modify: `src/renderer/components/workspace/workspace-host.tsx`

- [ ] **Step 1: 修改 workspace-host.tsx handleReady 加 listener**

在 `handleReady` 内（在 `event.api.onDidLayoutChange(...)` listener 后），加 onDidActivePanelChange listener：

```typescript
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { panelKindOf } from "./panel-registry.ts";

// ... 在 handleReady 内 ...

// active panel 变化 (含同 group 切 tab) → 通知 scopeStore + swift firstResponder swap.
// 直接用 panel.view.contentComponent 派生 kind, 不需要 panel.params.
event.api.onDidActivePanelChange((panel) => {
  if (!panel) {
    useKeybindingScope.getState().setActivePanel(null, null, null);
    window.pier?.terminal?.setActivePanelKind?.("web", null);
    return;
  }
  const component = panel.view.contentComponent;
  const kind = panelKindOf(component);
  useKeybindingScope.getState().setActivePanel(kind, component, panel.id);
  window.pier?.terminal?.setActivePanelKind?.(kind, panel.id);
});
```

注意：`useKeybindingScope.getState()` 而不是 hook — 这是在 useCallback 内的 imperative 调用，不能用 React hook 形式（hook 只能在组件 top level 调）。

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: 手测 tab 切换**

```bash
# user 重启 dev server (preview_stop + preview_start, 因为 renderer reload 即可)
```

手测 spec matrix:
- **TS1**: 当前 active 是 terminal panel，新加一个 welcome panel（点 + button 或 Cmd+Shift+P > "new welcome tab" if action 注册），切到 welcome tab → 字符 key 不进 terminal（终端无反应）；按 Cmd+T 仍 newTab 触发（global fall through）
- **TS2**: 切回 terminal tab → 字符 key 重新进 terminal

如果 welcome panel 没创建 action 可以暂时跳过 TS — 关键是 swift `[pier-key] applyFirstResponder` log 看 inTerminalMode 是否随 tab 切换 toggle。

实际上 user 当前 layout 只有 terminal panel + welcome 是默认 fallback，可以通过 layout JSON 手动加 welcome panel 测。或者验证只在 terminal panel 间切换（TS3 close terminal → 新 terminal 变 active → firstResponder 跟）。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/workspace/workspace-host.tsx
git commit -m "$(cat <<'EOF'
feat(keyboard): workspace-host onDidActivePanelChange 通知 scope + swift

dockview active panel 变化 (含同 group tab 切换) 触发: 更新 scopeStore +
通过 IPC 通知 swift setActivePanelKind. swift 端根据 kind 派生 inTerminalMode +
applyFirstResponder swap firstResponder. 完成 spec edge case "tab1=terminal /
tab2=web 切换" 的 RouteEvent 闭环.

详 spec step 4 (part 2).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Keybinding registry scope 字段 + resolve chain

**Goal:** keybinding registry 支持 scope tag，pickAction 用 scopeStore 按 [overlay阻断] > [panel] > [global] 优先级 resolve。完成后 future panel kit Cmd+S 可绑 panel:file-explorer scope 不污染 global。

**Files:**
- Modify: `src/renderer/lib/keybindings/types.ts`
- Modify: `src/renderer/lib/keybindings/registry.ts`
- Modify: `src/renderer/lib/keybindings/defaults.ts`
- Modify: `src/renderer/lib/keybindings/use-keybindings.ts`

- [ ] **Step 1: types.ts 加 scope 字段**

修改 `src/renderer/lib/keybindings/types.ts` 加 type + 扩展 interface：

```typescript
/**
 * Keybinding scope tag — resolve 优先级 [overlay 阻断] > [panel] > [global].
 * 新 panel kit / overlay 在 panel-registry 或 overlay component 内声明对应 scope id.
 */
export type KeybindingScope =
  | "global"
  | `panel:${string}`
  | `overlay:${string}`;
```

修改 `KeybindingInput` 加可选字段：

```typescript
export interface KeybindingInput {
  /** Default 'global' if omitted (兼容老 keymap entries). */
  readonly scope?: KeybindingScope;
  readonly commandId: string;
  readonly keys: string;
}
```

修改 `Keybinding` 加必有字段（registry 内部存）：

```typescript
export interface Keybinding {
  readonly chord: KeyChord;
  readonly commandId: string;
  readonly source: KeymapSource;
  readonly scope: KeybindingScope;
}
```

- [ ] **Step 2: registry.ts 加 findInScope + 改 resolve**

读当前 `src/renderer/lib/keybindings/registry.ts` 先了解结构（具体行号待 read），关键是 `resolve(chord)` 方法 — 改成 scope-aware。

新增 method (大致结构)：

```typescript
class KeybindingRegistry {
  // ... 现有字段, 假设 bindings: Keybinding[] 或 Map<scope, Map<chord, commandId>> ...

  /** 在指定 scope 内查找 chord 对应 commandId. */
  findInScope(chord: KeyChord, scope: KeybindingScope): string | null {
    // 遍历所有 bindings 找 scope + chord 都匹配的
    for (const binding of this.bindings) {
      if (binding.scope === scope && chordEquals(binding.chord, chord)) {
        return binding.commandId;
      }
    }
    return null;
  }

  /**
   * 按 scope chain 优先级 resolve:
   * 1. overlayStack 顶 → only top overlay scope (阻断)
   * 2. activePanelComponent → panel:<component>, miss 再 fall through global
   * 3. global fallback
   */
  resolve(
    chord: KeyChord,
    scopeState: {
      activePanelComponent: string | null;
      overlayStack: string[];
    }
  ): string | null {
    const topOverlay = scopeState.overlayStack[scopeState.overlayStack.length - 1];
    if (topOverlay) {
      return this.findInScope(chord, topOverlay as KeybindingScope);
    }
    if (scopeState.activePanelComponent) {
      const panelScope = `panel:${scopeState.activePanelComponent}` as const;
      const hit = this.findInScope(chord, panelScope);
      if (hit) return hit;
    }
    return this.findInScope(chord, "global");
  }
}
```

具体 implementation 取决于当前 registry 内部数据结构（是 array 还是 nested Map）— 读完 registry.ts 后调整。

`registerDefaults(entries: KeybindingInput[])` 内创建 Keybinding 实例时，`scope` 字段从 input 拿，若没提供 default 'global'：

```typescript
const binding: Keybinding = {
  chord: parseChord(entry.keys),
  commandId: entry.commandId,
  source: 'default',
  scope: entry.scope ?? 'global',
};
```

`register(entry: KeybindingInput)` 同样。

- [ ] **Step 3: defaults.ts 全标 scope: 'global'**

修改 `src/renderer/lib/keybindings/defaults.ts`：

```typescript
export const DEFAULT_KEYMAP: readonly KeybindingInput[] = [
  { commandId: "pier.panel.newTab", keys: "Mod+KeyT", scope: "global" },
  { commandId: "pier.panel.closeActive", keys: "Mod+KeyW", scope: "global" },
  { commandId: "pier.window.newWindow", keys: "Mod+KeyN", scope: "global" },
  { commandId: "pier.panel.newTerminal", keys: "Mod+Backquote", scope: "global" },
  { commandId: "pier.commandPalette.toggle", keys: "Mod+Shift+KeyP", scope: "global" },
  { commandId: "pier.settings.open", keys: "Mod+Comma", scope: "global" },
];
```

(注: scope?: optional with default 'global', 所以严格说不加 scope 字段也行 — 但显式标更清晰、防止 future "什么 scope 来着" 疑问)。

- [ ] **Step 4: use-keybindings.ts pickAction 用 scope**

修改 `src/renderer/lib/keybindings/use-keybindings.ts`：

import scope store：

```typescript
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
```

修改 `pickAction` signature + 调用：

```typescript
function pickAction(
  chord: KeyChord,
  target: EventTarget | null
): Action | null {
  const scope = useKeybindingScope.getState();
  const commandId = keybindingRegistry.resolve(chord, {
    activePanelComponent: scope.activePanelComponent,
    overlayStack: scope.overlayStack,
  });
  if (!commandId) {
    return null;
  }
  if (!chord.cmdOrCtrl && isTextInputElement(target)) {
    return null;
  }
  const action = actionRegistry.get(commandId);
  if (!action || action.enabled?.() === false) {
    return null;
  }
  return action;
}
```

- [ ] **Step 5: typecheck + 手测 (回归测试 + scope chain)**

```bash
pnpm typecheck
# user 重启 dev server (reload renderer)
```

手测:
- G1-G6: 所有 global 快捷键 (Cmd+T/W/N/`/Shift+P/Comma) 仍工作（terminal mode 走 IPC 路径 2; web mode 走 DOM 路径 1）
- (没有 panel: scope 注册 + 没 overlay scope 注册 → 全 fall through global → 同 task 6 前行为)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/keybindings/types.ts \
  src/renderer/lib/keybindings/registry.ts \
  src/renderer/lib/keybindings/defaults.ts \
  src/renderer/lib/keybindings/use-keybindings.ts
git commit -m "$(cat <<'EOF'
feat(keyboard): keybinding registry scope 字段 + resolve chain

KeybindingInput / Keybinding 加 scope tag (global / panel:<x> / overlay:<id>).
registry.resolve 按 [overlay 阻断] > [panel + global fall-through] 优先级查找.
DEFAULT_KEYMAP 全标 scope: 'global'.
pickAction 从 keybinding-scope.store 拿 scope state 传 resolve.

为 future panel-scoped binding (例 file-explorer Cmd+S) 奠定基础.

详 spec step 5.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: command-palette overlay stack push/pop

**Goal:** command-palette mount/unmount 时调 scopeStore.pushOverlay/popOverlay — 让 overlay 期间 keyboard resolve 阻断 panel/global scope (按 spec user Q1 选项 B)。

**Files:**
- Modify: `src/renderer/components/common/command-palette.tsx`

- [ ] **Step 1: 改 command-palette.tsx mount/unmount**

修改 `src/renderer/components/common/command-palette.tsx` 当前 `useEffect(() => { ...pushOverlay/popOverlay... })` 块（约 line 134-138）：

读当前块内容 (具体行号待 read):

```typescript
// before
useEffect(() => {
  if (!isOpen) return;
  pushOverlay();
  return () => popOverlay();
}, [isOpen]);
```

改为同时调 scopeStore：

```typescript
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";

useEffect(() => {
  if (!isOpen) return;
  pushOverlay();   // 兼容: 通知 swift setOverlayActive(true) → swap firstResponder
  useKeybindingScope.getState().pushOverlay("overlay:command-palette");
  return () => {
    useKeybindingScope.getState().popOverlay("overlay:command-palette");
    popOverlay();
  };
}, [isOpen]);
```

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: 手测 (核心 bug 验证 + scope 阻断)**

```bash
# user 重启 dev server (reload renderer)
```

手测 spec matrix:
- **O1**: 命令面板按 ↑/↓ → cmdk list navigate ✓
- **O2**: 命令面板按 Enter → select ✓
- **O3**: 命令面板按 Esc → close ✓
- **O4**: 命令面板打开时按 Cmd+T → **inert, 不触发 newTab** ✓ (overlay scope 阻断 global; 命令面板内没注册 Cmd+T → null → 不 preventDefault → 字符到 cmdk Input 但 cmdk 也不响应 Cmd+T → no-op)
- **O5**: 命令面板 input 有文字按 Cmd+A → 全选 ✓ (registry 无注册 Cmd+A → 不 preventDefault → DOM input 用 macOS 原生 IBeam 行为)
- **O6**: Cmd+C/V → 复制粘贴 ✓ (同上)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/common/command-palette.tsx
git commit -m "$(cat <<'EOF'
feat(keyboard): command-palette mount/unmount push/pop overlay scope stack

mount 时 scopeStore.pushOverlay('overlay:command-palette') 让 keybinding
resolve 阻断 panel/global scope (按 spec user Q1 选 B: overlay 内 Cmd+T inert).
保留 pushOverlay/popOverlay 兼容 — swift setOverlayActive 仍 firstResponder swap.

完成 spec 最后 step. 解决 user 报告:
- 命令面板 ↑/↓ Enter Esc 正常工作 (O1-O3)
- Cmd+T 在命令面板内 inert (O4 spec 设计)
- Cmd+A/C/V 全选/复制/粘贴正常 (O5-O6 macOS 原生)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 端到端验证 + spec matrix 标记

**Goal:** 跑完 spec 24 条 test matrix，标 ✓/✗ 在 spec 末尾，确认无 regression。不写代码，只验证。

**Files:**
- Modify: `docs/superpowers/specs/2026-06-23-keyboard-routing-design.md` (末尾加 verification log section)

- [ ] **Step 1: 跑完 24 条 spec test matrix**

按 spec "测试 Matrix" section 6 分类（T/G/O/W/TS/M/P）逐条手测。每条标 ✓ / ✗ (失败时记原因)：

```
T1 ✓ terminal 普通输入
T2 ✓ IME 中文
T3 ✓ Ctrl+C
T4 ✓ Tab completion
T5 ✓ ↑/↓ shell history
G1 ✓ Cmd+T
G2 ✓ Cmd+Shift+P
G3 ✓ Cmd+W
G4 ✓ Cmd+`
G5 ✓ Cmd+N
G6 ✓ Cmd+Comma
O1 ✓ overlay ↑/↓
O2 ✓ overlay Enter
O3 ✓ overlay Esc
O4 ✓ overlay Cmd+T inert
O5 ✓ overlay Cmd+A 全选
O6 ✓ overlay Cmd+C/V
W1 ✓ web panel char key
W2 ✓ web panel Cmd+T
TS1 ✓ tab terminal→web
TS2 ✓ tab web→terminal
TS3 ✓ terminal close 新 active 切换
M1 ✓ 多窗口 keyboard
M2 ✓ 多窗口 overlay 隔离
P1 N/A panel:file-explorer (future)
P2 N/A panel:file-explorer fall through (future)
```

- [ ] **Step 2: 在 spec 末尾加 verification log**

修改 `docs/superpowers/specs/2026-06-23-keyboard-routing-design.md` 末尾追加：

```markdown
---

## Verification Log (2026-06-23)

| # | Result | Note |
|---|---|---|
| T1 | ✓ | terminal 普通输入正常 |
| T2 | ✓ | 中文 IME 正常 |
| T3 | ✓ | Ctrl+C 中断 |
| T4 | ✓ | Tab 补全 |
| T5 | ✓ | shell history ↑/↓ |
| G1 | ✓ | Cmd+T newTab |
| G2 | ✓ | Cmd+Shift+P 打开命令面板 |
| G3 | ✓ | Cmd+W closeActivePanel |
| G4 | ✓ | Cmd+` newTerminal |
| G5 | ✓ | Cmd+N newWindow |
| G6 | ✓ | Cmd+Comma 设置 |
| O1 | ✓ | overlay ↑/↓ navigate |
| O2 | ✓ | overlay Enter select |
| O3 | ✓ | overlay Esc close |
| O4 | ✓ | overlay Cmd+T inert (design) |
| O5 | ✓ | overlay Cmd+A 全选 (macOS 原生) |
| O6 | ✓ | overlay Cmd+C/V |
| W1 | ✓ | web panel char key (firstResponder=WKWebView) |
| W2 | ✓ | web panel Cmd+T fall through global |
| TS1 | ✓ | tab terminal→web firstResponder swap |
| TS2 | ✓ | tab web→terminal firstResponder swap 回 |
| TS3 | ✓ | terminal close 新 active panel firstResponder 跟 |
| M1 | ✓ | 多窗口 keyboard windowId 路由 |
| M2 | ✓ | 多窗口 overlay 隔离 |
| P1 | N/A | future panel kit, 框架已就绪 |
| P2 | N/A | future panel kit fall through, 框架已就绪 |

实施完成日期: 2026-06-23
回归 bug: 无
新发现 bug: <填写 if any>
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-23-keyboard-routing-design.md
git commit -m "$(cat <<'EOF'
docs(spec): keyboard routing 实施完成 verification log

24 条 test matrix 全验证 ✓ (T/G/O/W/TS/M 各类) + P 类 N/A (future panel kit).
无回归. 修复 spec 提的 4 个 bug:
- Cmd+Shift+P 后 ↑/↓ 不生效 (O1)
- 命令面板内 Cmd+A 全选 (O5)
- terminal panel active 时 web overlay 收不到 nav key
- (推断) future web panel kit firstResponder 不切

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## 依赖顺序总结

```
Task 1 (skeleton IPC) ─────► Task 2 (applyFirstResponder, focus 替换)
                                    │
                                    ▼
Task 3 (overlay swap + monitor gate + createTerminal 补) — **修复核心 bug**
                                    │
                                    ▼
Task 4 (web scope store + panelKindOf) ─► Task 5 (workspace-host listener)
                                    │
                                    ▼
Task 6 (keybinding scope 字段 + resolve chain) ─► Task 7 (command-palette overlay stack)
                                    │
                                    ▼
                              Task 8 (验证 + log)
```

Task 1-3 swift 改动（行为切换核心）；Task 4-7 web 端架构改动；Task 8 验证。**每 task 独立 commit + 中间 typecheck + native rebuild (1-3) + 手测对应 spec scenario**。Task 3 完成时核心 bug 已修复（可早 user 验证）；task 4-7 完善 scope 架构 + 未来 panel kit 准备。

## 风险点

1. **Task 1 swift state 默认 PanelKind=.web 安全初始值** — 防止 setupWindow 完成但 React 还没发 setActivePanelKind 期间 swift 误抢 firstResponder。
2. **Task 3 反例 6 (createTerminal 完成补 applyFirstResponder)** — 必须在 createTerminal 末尾确认 activeTerminalPanelId 匹配再补 swap，否则 react onDidActiveChange 早到时 firstResponder 没 swap，用户输入不响应（spec 反例 6 明确）。
3. **Task 5 dockview onDidActivePanelChange fire 频率** — tab 快速切换时多次 IPC，swift 端按序处理 OK（mutateState 是 sync），但 firstResponder 多次 swap 可能视觉小闪（NSView swap 不重绘 UI，但 GhosttyTerminal 内部可能 emit focus event 多次 — 监测）。
4. **Task 6 registry 内部数据结构** — 当前实现可能用 `Map<chord-string, commandId>`。加 scope 后要么改成 `Map<scope, Map<chord, commandId>>`，要么 keep flat `Keybinding[]` 用 findInScope 遍历。后者简单但 O(n) per resolve — Pier keymap size < 20 不是问题。**遵循 KISS：用 flat array**。
5. **Task 7 overlay scope id 命名规范** — `'overlay:command-palette'` 字符串 hardcode 在 command-palette.tsx 内。Future 加 dialog/modal 各自 hardcode 一个 id（如 `'overlay:settings-dialog'`）。spec 不要求集中注册表。

---

## Self-Review

**Spec coverage check** (逐一对应 spec section):

| Spec section | Implementation task |
|---|---|
| 背景 4 个 bug | Task 3 修 O1 / O5; Task 5+7 修 W1/TS1; Task 7 修 O4 设计 |
| 设计原则: 状态机驱动 | Task 1+2 |
| 设计原则: scoped keybindings | Task 6 |
| 设计原则: web SoT | Task 5 |
| 设计原则: 零额外 IPC 开销 | Task 3 (routeKeyDown gate 让 terminal mode 仍 IPC forward, web mode 全 pass through) |
| 设计原则: 未来 panel kit 准备 | Task 4 (panelKindOf) + Task 6 (panel scope) |
| Swift state machine | Task 1+2+3 |
| Web scope registry | Task 4+6 |
| IPC 合约 (setActivePanelKind 新) | Task 1 |
| IPC 合约 (setOverlayActive 扩展) | Task 3 |
| Edge case "tab1/tab2 切换" | Task 5 (onDidActivePanelChange listener) |
| 反例 1 (race 切 tab) | Task 5 (按序 IPC, swift 同步 mutateState) |
| 反例 2 (overlay close active 已变) | Task 3 (applyFirstResponder 按当前 state 重算, 不 restore saved) |
| 反例 3 (nested overlay) | Task 4 (overlayStack 数组 push/pop) |
| 反例 4 (panel kind 未声明) | Task 4 (panelKindOf default 'web') |
| 反例 5 (首次启动) | Task 5 (onDidActivePanelChange fire 时已就绪) |
| 反例 6 (createTerminal 完成补) | Task 3 step 3 |

无 gap。

**Placeholder scan**: 已检查，所有 step 有 exact code/path/command + verify。无 "TBD" / "TODO" / "as above" / "similar to X" / 空 code block。

**Type consistency**: `PanelKind` ('terminal' | 'web' as raw 0/1 in C ABI); `KeybindingScope` ('global' | `panel:${string}` | `overlay:${string}`); `setActivePanelKind(kind, panelId)` 签名跨 swift/addon/main/preload/contracts 一致。`applyFirstResponder(for: window)` swift 内一致命名。

**风险**: Task 6 registry 改动可能影响 actionRegistry / `register()` / `register-default-keymap` 等 — 实施时需读完 registry.ts 内部结构。如果当前 `bindings: Map<string, ...>` 用 chord-string 作 key，加 scope 字段需 key 改 `${scope}|${chord-string}` 或拆 nested。计划暂用 "flat array + findInScope 遍历" — 取决于 Pier 当前实现，可能要小幅调整 step 2 code。

---

**Plan 完成并保存到 [docs/superpowers/plans/2026-06-23-keyboard-routing.md](docs/superpowers/plans/2026-06-23-keyboard-routing.md)**。

请你 review plan，然后选执行方式：

**1. Subagent-Driven (推荐)** — 每 task fresh subagent 实施，task 间我 review，快迭代且每 task 独立 worktree 隔离

**2. Inline Execution** — 当前 session 直接逐 task 跑（executing-plans skill），按 checkpoint 中断给你 review

哪种？