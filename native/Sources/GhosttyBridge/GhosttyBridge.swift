// native/Sources/GhosttyBridge/GhosttyBridge.swift
//
// Pier Ghostty Bridge — EventRouterView 架构
//
// NSView 层级 (从底到顶):
//   1. Ghostty NSView 容器 — Metal GPU 渲染终端
//   2. WKWebView (isOpaque=false) — 透明 web UI
//   3. EventRouterView — 不画像素，hitTest 路由事件
//
// PIER: 与 demo 的差异:
//   - 终端在 WKWebView 之下 (demo 在之上)
//   - 新增 EventRouterView 做事件路由
//   - 新增 setupWindow / input routing API
//   - WKWebView 设为透明

import AppKit
import CoreText
import Darwin
@_spi(PierDiagnostics) import GhosttyTerminal
import GhosttyTheme

// MARK: - Helpers

/// Pier IPC 边界统一传 `#RRGGBB`. GhosttyThemeDefinition 的 background/foreground/
/// cursorColor/selectionBackground 直接转给 builder, 不带 #; palette[i] 由库内
/// 拼接 `"#\(value)"`. 这里统一剥前缀, 既符合两类 API.
private func stripHash(_ s: String) -> String {
    s.hasPrefix("#") ? String(s.dropFirst()) : s
}

// MARK: - EventRouterView

/// 事件路由 — 统一处理 mouse 和 keyboard 在 Pier 透明 WKWebView + Ghostty NSView
/// 架构下的分发. 放在 contentView 最顶层.
///
/// Mouse: 透明 NSView, override hitTest 按位置路由:
/// web 浮层区域 → Web; terminal 区域 → terminal; 其他 → Web.
///
/// Keyboard: 用 NSEvent local monitor 拦截. terminal 一旦 focus 就消费所有 key
/// (Ghostty TerminalView 是 firstResponder), 导致 web 层 useKeyboardShortcuts 收
/// 不到全局快捷键. 含 Cmd 修饰的组合 → 通过 forwardCallback 把 chord 转给 main
/// process, main 通过 IPC 调 renderer 直接 resolve action — 完全绕开 NSView
/// responder chain (因为 wk.keyDown forward 在 Electron 43 ViewsCompositorSuperview
/// 架构下不可靠 — 真正渲染 web 的是 ViewsCompositorSuperview 不是 WKWebView).
/// 非 Cmd 组合放行给 firstResponder (terminal 正常处理 Ctrl+C / 普通输入 / IME 等).
final class EventRouterView: NSView {
    struct Target {
        let rect: NSRect
        let view: NSView
    }

    var targets: [String: Target] = [:]
    var webOverlayRects: [NSRect] = []

    /// 路由决策 ring buffer — hitTest / routeKeyDown / routeRightMouseDown 的最近
    /// N 次判定, 供 debug snapshot 事后诊断 "看得见但点不到 / 按键不响应" 类问题.
    /// hitTest 在无 acceptsMouseMoved 场景下频率不高 (mouseDown / scrollWheel /
    /// dragged), 上限 64 足以覆盖用户复现 bug 的最近数秒操作.
    ///
    /// `seq` 单调递增 (不复用), 供 renderer 做稳定 React key; 一段时间无事件时
    /// UInt64 也够用几百年。绝不把用户按键的 raw chars 放进 payload —— 密码/凭据
    /// 会随 debug snapshot 落 UI; 需要"按了什么"信息时只写 charsLen + mods。
    private struct RouterDecisionRecord {
        let capturedAt: TimeInterval
        let kind: String
        let payload: [String: Any]
        let seq: UInt64
    }
    private var recentDecisions: [RouterDecisionRecord] = []
    private let recentDecisionsLock = NSLock()
    private var nextDecisionSeq: UInt64 = 0
    private static let maxRecentDecisions = 64

    private weak var ownerWindow: NSWindow?
    private var keyMonitor: Any?
    private var mouseMonitor: Any?

    /// 全局 callback: swift monitor 捕获 Cmd+key 后调用, 把 chord 转给 main process.
    /// 签名 (browserWindowId, modifierFlags, chars) — 多窗口下 main 用 windowId
    /// 路由 (`BrowserWindow.fromId`), 而不是 `getFocusedWindow()` (背景窗口按 key
    /// 时 focused 已切走会路由错).
    static var forwardCmdKeyCallback: ((Int, UInt, String) -> Void)?

    /// Modifier state 转发: terminal NSView 做 firstResponder 时, Web 收不到纯 Cmd
    /// flagsChanged; 通过此通道只同步修饰键状态, 不消费事件.
    static var forwardModifierStateCallback: ((Int, UInt) -> Void)?

    /// Right-mouse 转发: 用户在 terminal 区域右键 → main → renderer → 弹原生菜单.
    /// 签名 (browserWindowId, panelId, contentX, contentY) — 坐标系是 BrowserWindow
    /// 的 contentView (top-left origin, flipped), 即 Electron renderer 内坐标, 也是
    /// Electron Menu.popup({x,y}) 期待的格式.
    static var forwardRightMouseCallback: ((Int, String, Double, Double) -> Void)?

    /// Electron BrowserWindow.id — main 进程调 setupWindow 时传入. forward callback
    /// 用它告诉 main 这个 key event 来自哪个 window.
    private var browserWindowId: Int = -1

    // Startup fallback before the renderer hydrates user keybindings and calls
    // setTerminalAppShortcutKeys. Keep this list in sync with DEFAULT_KEYMAP.
    private static var terminalAppShortcutKeys: Set<String> = [
        "Ctrl+Shift+ArrowDown",
        "Ctrl+Shift+ArrowLeft",
        "Ctrl+Shift+ArrowRight",
        "Ctrl+Shift+ArrowUp",
        "Ctrl+Shift+KeyD",
        "Mod+Alt+KeyR",
        "Mod+Comma",
        "Mod+Digit0",
        "Mod+Digit1",
        "Mod+Digit2",
        "Mod+Digit3",
        "Mod+Digit4",
        "Mod+Digit5",
        "Mod+Digit6",
        "Mod+Digit7",
        "Mod+Digit8",
        "Mod+Digit9",
        "Mod+Equal",
        "Mod+KeyD",
        "Mod+KeyF",
        "Mod+KeyN",
        "Mod+KeyT",
        "Mod+KeyW",
        "Mod+Minus",
        "Mod+Numpad0",
        "Mod+Numpad1",
        "Mod+Numpad2",
        "Mod+Numpad3",
        "Mod+Numpad4",
        "Mod+Numpad5",
        "Mod+Numpad6",
        "Mod+Numpad7",
        "Mod+Numpad8",
        "Mod+Numpad9",
        "Mod+Shift+Enter",
        "Mod+Shift+Equal",
        "Mod+Shift+KeyD",
        "Mod+Shift+KeyP",
        "Mod+Shift+KeyA",
    ]

    static func setTerminalAppShortcutKeys(_ keys: Set<String>) {
        terminalAppShortcutKeys = keys
    }

    override var isOpaque: Bool { false }
    override var isFlipped: Bool { true }  // 对齐 Electron contentView 的 top-left 坐标系
    override func draw(_ dirtyRect: NSRect) {}

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard let sv = superview else { return nil }
        let local = convert(point, from: sv)
        if containsWebOverlay(local) {
            recordHitTest(local: local, decision: "web-overlay", matchedPanelId: NSNull())
            return nil
        }
        if let (matchedPanelId, target) = terminalTarget(at: local) {
            recordHitTest(local: local, decision: "terminal", matchedPanelId: matchedPanelId)
            let p = target.view.superview?.convert(point, from: sv) ?? point
            return target.view.hitTest(p)
        }
        recordHitTest(local: local, decision: "miss", matchedPanelId: NSNull())
        return nil
    }

    private func containsWebOverlay(_ point: NSPoint) -> Bool {
        webOverlayRects.contains { $0.contains(point) }
    }

    private func terminalTarget(at point: NSPoint) -> (String, Target)? {
        for (panelId, target) in targets {
            if target.rect.contains(point) {
                return (panelId, target)
            }
        }
        return nil
    }

    private func recordDecision(kind: String, payload: [String: Any]) {
        recentDecisionsLock.lock()
        defer { recentDecisionsLock.unlock() }
        let seq = nextDecisionSeq
        nextDecisionSeq &+= 1
        let record = RouterDecisionRecord(
            capturedAt: Date().timeIntervalSince1970,
            kind: kind,
            payload: payload,
            seq: seq
        )
        recentDecisions.append(record)
        if recentDecisions.count > Self.maxRecentDecisions {
            recentDecisions.removeFirst(recentDecisions.count - Self.maxRecentDecisions)
        }
    }

    /// NaN / Infinity CGFloat 从 broken superview convert 溢出到 payload 会让
    /// JSONSerialization.isValidJSONObject 全盘拒绝, jsonString 返回 "{}", 整个
    /// debug snapshot 塌成空对象 —— 用一个 sanitize 保证坐标非有限时用 -1 兜底,
    /// UI 上会看到明显异常值而不是无声消失。
    private static func sanitizedCoordinate(_ value: CGFloat) -> Double {
        let d = Double(value)
        return d.isFinite ? d : -1
    }

    private func recordHitTest(local: NSPoint, decision: String, matchedPanelId: Any) {
        recordDecision(kind: "hit-test", payload: [
            "x": Self.sanitizedCoordinate(local.x),
            "y": Self.sanitizedCoordinate(local.y),
            "decision": decision,
            "matchedPanelId": matchedPanelId,
            "targetsCount": targets.count,
            "webOverlayCount": webOverlayRects.count,
        ])
    }

    private func recordRightMouse(local: NSPoint, decision: String, matchedPanelId: Any) {
        recordDecision(kind: "right-mouse", payload: [
            "x": Self.sanitizedCoordinate(local.x),
            "y": Self.sanitizedCoordinate(local.y),
            "decision": decision,
            "matchedPanelId": matchedPanelId,
        ])
    }

    /// Debug snapshot 出口: 导出最近路由决策序列, 供 renderer 侧 debug window 展示.
    /// 顺序为 append 序 (旧 → 新); renderer 侧倒序即最新在顶.
    ///
    /// `seq` 用 Double 表达 (JSON 只有 number, UInt64 高位可能落 53 位精度外, 但一次
    /// pier 会话内递增速度不会突破 2^53). renderer 用 seq 做 React key 保持行 identity.
    func snapshotRecentDecisions() -> [[String: Any]] {
        recentDecisionsLock.lock()
        defer { recentDecisionsLock.unlock() }
        return recentDecisions.map { record in
            [
                "at": record.capturedAt,
                "kind": record.kind,
                "payload": record.payload,
                "seq": Double(record.seq),
            ]
        }
    }

    /// 在 setupWindow 后调用一次, 绑定 window 并安装 keyboard + mouse 监听.
    /// browserWindowId 来自 Electron BrowserWindow.id, forward 时回传给 main 路由.
    func attachInputRouting(window: NSWindow, browserWindowId: Int) {
        ownerWindow = window
        self.browserWindowId = browserWindowId
        if keyMonitor == nil {
            keyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .flagsChanged]) {
                [weak self] event in
                guard let self else { return event }
                switch event.type {
                case .keyDown:
                    return self.routeKeyDown(event)
                case .flagsChanged:
                    return self.routeFlagsChanged(event)
                default:
                    return event
                }
            }
        }
        if mouseMonitor == nil {
            mouseMonitor = NSEvent.addLocalMonitorForEvents(matching: .rightMouseDown) {
                [weak self] event in
                guard let self else { return event }
                return self.routeRightMouseDown(event)
            }
        }
    }

    func detachInputRouting() {
        if let monitor = keyMonitor {
            NSEvent.removeMonitor(monitor)
            keyMonitor = nil
        }
        if let monitor = mouseMonitor {
            NSEvent.removeMonitor(monitor)
            mouseMonitor = nil
        }
        ownerWindow = nil
    }

    private static func keyCode(from chars: String) -> String? {
        switch chars.lowercased() {
        case "a"..."z":
            return "Key\(chars.uppercased())"
        case "0"..."9":
            return "Digit\(chars)"
        case "`":
            return "Backquote"
        case ",":
            return "Comma"
        case ".":
            return "Period"
        case "/":
            return "Slash"
        case ";":
            return "Semicolon"
        case "'":
            return "Quote"
        case "[":
            return "BracketLeft"
        case "]":
            return "BracketRight"
        case "\\":
            return "Backslash"
        case "-":
            return "Minus"
        case "=":
            return "Equal"
        case "\r":
            return "Enter"
        case "\u{3}":
            return "Enter"
        case "\u{F700}":
            return "ArrowUp"
        case "\u{F701}":
            return "ArrowDown"
        case "\u{F702}":
            return "ArrowLeft"
        case "\u{F703}":
            return "ArrowRight"
        default:
            return nil
        }
    }

    private static func terminalAppShortcutKey(modifierFlags mods: NSEvent.ModifierFlags, chars: String) -> String? {
        guard let code = keyCode(from: chars) else { return nil }

        var parts: [String] = []
        if mods.contains(.command) {
            parts.append("Mod")
        }
        if mods.contains(.control) {
            parts.append("Ctrl")
        }
        if mods.contains(.option) {
            parts.append("Alt")
        }
        if mods.contains(.shift) {
            parts.append("Shift")
        }
        parts.append(code)
        return parts.joined(separator: "+")
    }

    private func passThroughToTerminal(window: NSWindow, event: NSEvent) -> NSEvent? {
        if GhosttyBridgeImpl.shared.prepareTerminalForOrdinaryKeyDown(
            window: window, event: event
        ) {
            return nil
        }
        return event
    }

    private func routeFlagsChanged(_ event: NSEvent) -> NSEvent? {
        guard let window = ownerWindow, event.window === window else { return event }
        let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        EventRouterView.forwardModifierStateCallback?(browserWindowId, mods.rawValue)
        return event
    }

    /// 路由 keyDown: terminal keyboard target 下只截获 Pier 明确声明的 app 快捷键, 其他
    /// Cmd / Ctrl+Shift 组合交给 Ghostty, 避免吞掉终端编辑和 TUI 快捷键.
    private func routeKeyDown(_ event: NSEvent) -> NSEvent? {
        guard let window = ownerWindow, event.window === window else { return event }

        let activeTerminalPanelId =
            GhosttyBridgeImpl.shared.activeTerminalPanelId(for: window)
        let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let chars = event.charactersIgnoringModifiers ?? ""
        let activeTerminalPanelIdValue: Any =
            activeTerminalPanelId.map { $0 as Any } ?? NSNull()

        // 只写 charsLen 数字, 绝不写 raw chars: terminal-passthrough 分支覆盖 sudo
        // 密码输入, ring buffer 落到 debug snapshot 会随 UI 明文暴露给任何打开
        // pier.terminal.openDebugWindow 的人。mods + charsLen 已够诊断 "有键但去哪了"。
        func record(_ decision: String) {
            recordDecision(kind: "key-down", payload: [
                "charsLen": chars.count,
                "mods": Int(mods.rawValue),
                "acceptsTerminalKeyboard": activeTerminalPanelId != nil,
                "activeTerminalPanelId": activeTerminalPanelIdValue,
                "decision": decision,
            ])
        }

        // Web keyboard target: 全 pass through. Web DOM 自然接所有 key
        // (含 ↑/↓/Enter/Cmd+A/Cmd+T 等). 不在此处拦截 Cmd+key — let web's
        // useKeyboardShortcuts 路径 1 (DOM keydown capture) 处理.
        guard activeTerminalPanelId != nil else {
            record("web-passthrough")
            return event
        }

        // Terminal mode: 只把运行时 allowlist 内的 Pier app 快捷键 forward 给 web
        // (路径 2 IPC), 其他组合全部 pass through 给 Ghostty.
        let isCmd = mods.contains(.command)

        // macOS menu reserved keys (Cmd+Q/Cmd+H/Cmd+M/Cmd+Comma 等 role-bound items)
        // 必须先让 NSApp.mainMenu 处理. performKeyEquivalent 命中 menu item 后会调
        // 该 item 的 action 并返回 true; 没命中返回 false. 不让 menu 优先会让 Cmd+Q
        // 永远 swallow 在 web forward 链 (web 没注册 → 静默 drop, 用户感受"Cmd+Q 失效").
        // 仅 Cmd 路径走 menu — menu items 全部都是 Cmd+... 修饰, Ctrl+Shift 不参与.
        if isCmd, NSApp.mainMenu?.performKeyEquivalent(with: event) == true {
            record("menu-consumed")
            return nil
        }

        guard !chars.isEmpty else {
            record("terminal-passthrough-no-chars")
            return passThroughToTerminal(window: window, event: event)
        }
        guard let shortcutKey = Self.terminalAppShortcutKey(modifierFlags: mods, chars: chars),
              Self.terminalAppShortcutKeys.contains(shortcutKey) else {
            record("terminal-passthrough")
            return passThroughToTerminal(window: window, event: event)
        }

        record("shortcut-forward")
        EventRouterView.forwardCmdKeyCallback?(browserWindowId, mods.rawValue, chars)
        return nil
    }

    /// 路由 rightMouseDown:
    /// - 非 owner window: 放行
    /// - 在 web overlay rect 内: 放行给 Web, 不触发 terminal 菜单
    /// - 不在任何 terminal target rect 内: 放行 (空白区 / web panel 让 React onContextMenu 处理)
    /// - 在 terminal rect 内: forward (windowId, panelId, x, y) 给 main, 消费事件
    private func routeRightMouseDown(_ event: NSEvent) -> NSEvent? {
        guard let window = ownerWindow, event.window === window else { return event }
        // 把 window 坐标转 EventRouterView 局部坐标 (与 hitTest 同套坐标变换);
        // EventRouterView.isFlipped=true 让 local 坐标系是 top-left origin, 跟 Electron
        // BrowserWindow contentView 一致, 可直接给 main 做 Menu.popup({x,y}).
        let local = self.convert(event.locationInWindow, from: nil)
        if containsWebOverlay(local) {
            recordRightMouse(local: local, decision: "web-overlay", matchedPanelId: NSNull())
            return event
        }
        if let (panelId, _) = terminalTarget(at: local) {
            recordRightMouse(local: local, decision: "terminal", matchedPanelId: panelId)
            TerminalContainerView.forwardFocusRequestCallback?(browserWindowId, panelId)
            EventRouterView.forwardRightMouseCallback?(
                browserWindowId, panelId, Double(local.x), Double(local.y)
            )
            return nil  // 消费, 不让 terminal NSView 收到右键
        }
        recordRightMouse(local: local, decision: "miss", matchedPanelId: NSNull())
        return event
    }

    deinit {
        if let monitor = keyMonitor {
            NSEvent.removeMonitor(monitor)
        }
        if let monitor = mouseMonitor {
            NSEvent.removeMonitor(monitor)
        }
    }
}

// MARK: - Terminal event delegate adapter

/// 同时实现 PwdDelegate + TitleDelegate, 每个 terminal 一个实例, 持有 panelId
/// + browserWindowId 用于事件路由. 利用 libghostty callbackBridge 的动态转型机制
/// (`as? any Protocol`), 单个 delegate 对象可被同时识别为多个 protocol — 因此可
/// 挂多个事件类型而 delegate 槽位只占用一个 (TerminalView.delegate 是单一 weak ref).
///
/// 后续 bell / focus / close / progress 等都可挂到这个 class — 只需 conform 对应
/// protocol 并加 forward callback 通道.
///
/// 自持 browserWindowId 而非全局反查:panelId 在 Pier 中不保证跨窗口唯一
/// (workspace-host default layout 都用 "terminal-1"), 用全局 panelId→windowId map
/// 会被后建立的同名 panel 覆盖, 事件路由到错窗口. delegate 跟随 Terminal 生命周期,
/// 创建时确定路由目标, 干净无歧义.
///
/// weak-set 到 terminalView.delegate, strong-hold 在 Terminal struct 中以保证
/// 生命周期 (terminalView.delegate 是 weak — 没 strong owner 会立即 nil).
@MainActor
final class TerminalEventDelegate: TerminalSurfacePwdDelegate,
    TerminalSurfaceOpenURLDelegate,
    TerminalSurfaceFocusDelegate,
    TerminalSurfaceSearchDelegate,
    TerminalSurfaceTitleDelegate,
    TerminalSurfaceCommandFinishedDelegate,
    TerminalSurfaceCommandStartedDelegate,
    TerminalSurfaceCloseDelegate,
    TerminalSurfaceScrollbarDelegate
{
    let panelId: String
    var browserWindowId: Int
    let lifecycleId: String
    weak var scrollbarSink: TerminalScrollbarStateSink?
    private(set) var isSurfaceFocused = false
    private var searchSelected: Int = -1
    private var searchTotal: Int = 0

    /// 全局 callback: 收到 OSC 7 path 时调用, 把 (browserWindowId, panelId, path)
    /// 转给 main process.
    static var forwardPwdCallback: ((Int, String, String) -> Void)?

    /// 全局 callback: 用户激活终端超链接时调用, 把 (browserWindowId, panelId, url, kind)
    /// 转给 main process.
    static var forwardOpenUrlCallback: ((Int, String, String, String) -> Void)?

    /// 全局 callback: 收到 OSC 0/2 title 时调用, 把 (browserWindowId, panelId, title)
    /// 转给 main process. TUI 应用 (claude / vim / aider) 主动通过 OSC 0/2 写自定义
    /// title — descriptor.long 的最高优先级来源.
    static var forwardTitleCallback: ((Int, String, String, String) -> Void)?

    /// 全局 callback: Ghostty search result update → main process.
    /// selected 使用 Ghostty 原始 0-based 序号；无匹配时为 -1。
    static var forwardSearchCallback: ((Int, String, Int, Int) -> Void)?

    /// 全局 callback: Ghostty shell integration command_finished → main process.
    /// exitCode 为 nil 时在 C ABI 边界统一转成 -1。
    static var forwardCommandFinishedCallback: ((Int, String, String, Int, UInt64) -> Void)?

    /// 全局 callback: Ghostty shell integration command_started → main process.
    /// commandLine 可能为空字符串（shell 未提供 OSC 133 C/633 E cmdline 时）.
    static var forwardCommandStartedCallback: ((Int, String, String, String) -> Void)?

    /// 全局 callback: Ghostty surface close → main process.
    /// processAlive=false 表示底层进程已自然退出；true 表示 surface 关闭时进程仍存活。
    static var forwardProcessClosedCallback: ((Int, String, String, Bool) -> Void)?

    init(panelId: String, browserWindowId: Int, lifecycleId: String) {
        self.panelId = panelId
        self.browserWindowId = browserWindowId
        self.lifecycleId = lifecycleId
    }

    func terminalDidChangeWorkingDirectory(_ path: String) {
        TerminalEventDelegate.forwardPwdCallback?(browserWindowId, panelId, path)
    }

    func terminalDidRequestOpenURL(_ url: String, kind: TerminalOpenURLKind) {
        let kindRaw: String
        switch kind {
        case .text: kindRaw = "text"
        case .html: kindRaw = "html"
        case .unknown: kindRaw = "unknown"
        }
        TerminalEventDelegate.forwardOpenUrlCallback?(
            browserWindowId,
            panelId,
            url,
            kindRaw
        )
    }

    func terminalDidChangeTitle(_ title: String) {
        TerminalEventDelegate.forwardTitleCallback?(browserWindowId, panelId, lifecycleId, title)
    }

    func terminalDidFinishCommand(exitCode: Int?, durationNanos: UInt64) {
        TerminalEventDelegate.forwardCommandFinishedCallback?(
            browserWindowId,
            panelId,
            lifecycleId,
            exitCode ?? -1,
            durationNanos
        )
    }

    func terminalDidStartCommand(commandLine: String) {
        TerminalEventDelegate.forwardCommandStartedCallback?(
            browserWindowId,
            panelId,
            lifecycleId,
            commandLine
        )
    }

    func terminalDidClose(processAlive: Bool) {
        TerminalEventDelegate.forwardProcessClosedCallback?(
            browserWindowId,
            panelId,
            lifecycleId,
            processAlive
        )
    }

    func terminalDidUpdateScrollbar(_ state: TerminalScrollbarState) {
        scrollbarSink?.terminalScrollbarStateDidChange(state)
    }

    func terminalDidChangeFocus(_ focused: Bool) {
        isSurfaceFocused = focused
    }

    private func forwardSearchState() {
        TerminalEventDelegate.forwardSearchCallback?(
            browserWindowId,
            panelId,
            searchTotal,
            searchTotal > 0 ? searchSelected : -1
        )
    }

    func terminalDidUpdateSearchTotal(_ total: Int) {
        searchTotal = max(0, total)
        if searchTotal == 0 {
            searchSelected = -1
        }
        forwardSearchState()
    }

    func terminalDidUpdateSearchSelected(_ selected: Int) {
        searchSelected = selected
        forwardSearchState()
    }
}

// MARK: - Terminal record

private struct Terminal {
    let containerView: TerminalContainerView
    let terminalView: TerminalView
    var parentWindow: NSWindow
    let outputSession: InMemoryTerminalSession?
    /// EventDelegate adapter (strong-hold — terminalView.delegate 是 weak).
    /// 同时实现 PwdDelegate + TitleDelegate. 随 Terminal 一起释放, terminalView
    /// weak ref 自动 nil, 不留 dangling.
    let eventDelegate: TerminalEventDelegate
    var surfaceVisible: Bool
}

private struct TerminalRuntimePreferences {
    var fontFamilies: [String] = []
    var fontSize: Float = 0
    var cursorStyle: TerminalCursorStyle = .block
    var cursorBlink: Bool = true
    var scrollbackLimitBytes: UInt64 = 64_000_000
    var pasteProtection: Bool = true
}

struct TerminalLayoutState {
    private(set) var authoritativeContentSize: NSSize
    private(set) var authoritativeFrame: NSRect
    private(set) var presentedFrame: NSRect

    init(authoritativeContentSize: NSSize, authoritativeFrame: NSRect) {
        self.authoritativeContentSize = authoritativeContentSize
        self.authoritativeFrame = authoritativeFrame
        self.presentedFrame = authoritativeFrame
    }

    mutating func rememberAuthoritativeLayout(contentSize: NSSize, frame: NSRect) {
        authoritativeContentSize = contentSize
        authoritativeFrame = frame
        presentedFrame = frame
    }
}

private struct TerminalWindowFrame: Codable {
    let height: Double
    let width: Double
    let x: Double
    let y: Double

    var nsRect: NSRect {
        NSRect(x: x, y: y, width: width, height: height)
    }
}

private struct TerminalWindowEntry: Codable {
    let focused: Bool
    let frame: TerminalWindowFrame?
    let panelId: String
    let visible: Bool
}

private struct TerminalWebOverlayRectEntry: Codable {
    let frame: TerminalWindowFrame
    let id: String
}

private struct TerminalKeyboardTargetEnvelope: Codable {
    let kind: String
    let panelId: String?

    var terminalPanelId: String? {
        kind == "terminal" ? panelId : nil
    }

    var debugPayload: [String: Any] {
        if let terminalPanelId {
            return ["kind": "terminal", "panelId": terminalPanelId]
        }
        return ["kind": "web"]
    }
}

private struct TerminalWindowStateEnvelope: Codable {
    let keyboardTarget: TerminalKeyboardTargetEnvelope
    let nativeApplySequence: Int
    let reason: String
    let rendererSequence: Int
    let terminals: [TerminalWindowEntry]
    let webOverlayRects: [TerminalWebOverlayRectEntry]
    let windowFocused: Bool
}

enum NativeApplyResult: Int32 {
    case error = -1
    case applied = 0
    case unchanged = 1
    case stale = 2
}

private struct TerminalWindowApplyState {
    var lastAppliedNativeApplySequence: Int = 0
    var lastAppliedRendererSequence: Int = 0
    var lastReason: String = ""
    var staleDiscardCount: Int = 0
}

// MARK: - Bridge implementation

@MainActor
final class GhosttyBridgeImpl {
    static let shared = GhosttyBridgeImpl()

    /// EventRouter 命中矩形向内收缩的像素数, 给 dockview sash (4px) 留出事件通道。
    /// 终端滚动条由 SPM 内部的 NSScrollView 管理, 这里不再计算独立滚动条区域。
    private static let hitInset: CGFloat = 5

    private var terminals: [String: Terminal] = [:]
    private var eventRouters: [ObjectIdentifier: EventRouterView] = [:]  // per-window
    private var terminalBackgrounds: [ObjectIdentifier: NSColor] = [:]
    private var terminalLayouts: [String: TerminalLayoutState] = [:]
    /// per-window TerminalController. window close 时通过 detachWindow 释放 — 避免
    /// 旧 controller 内 session/PTY 列表跨 window 累积 (singleton 不会随 window
    /// 销毁而清理).
    private var controllers: [ObjectIdentifier: TerminalController] = [:]
    private var terminalRuntimePreferences: [ObjectIdentifier: TerminalRuntimePreferences] = [:]
    private var appliedWindowStates: [ObjectIdentifier: TerminalWindowStateEnvelope] = [:]
    private var windowApplyStates: [ObjectIdentifier: TerminalWindowApplyState] = [:]

    /// NSWindow → browserWindowId 映射. setupWindow 时建立, detachWindow 时清理.
    /// createTerminal 用它给 TerminalEventDelegate 初始化 browserWindowId.
    private var windowToBrowserWindowId: [ObjectIdentifier: Int] = [:]

    private func controller(for window: NSWindow) -> TerminalController {
        let windowId = ObjectIdentifier(window)
        if let existing = controllers[windowId] { return existing }
        let c = TerminalController(
            configuration: Self.terminalConfiguration(
                from: terminalRuntimePreferences[windowId] ?? TerminalRuntimePreferences()
            )
        )
        controllers[windowId] = c
        return c
    }

    private static func terminalConfiguration(
        from preferences: TerminalRuntimePreferences
    ) -> TerminalConfiguration {
        TerminalConfiguration { builder in
            configureDefaultTerminalAppearance(&builder)
            for family in preferences.fontFamilies where !family.isEmpty {
                builder.withFontFamily(family)
            }
            if preferences.fontSize > 0 {
                builder.withFontSize(preferences.fontSize)
            }
            builder.withCursorStyle(preferences.cursorStyle)
            builder.withCursorStyleBlink(preferences.cursorBlink)
            builder.withCustom("scrollback-limit", "\(preferences.scrollbackLimitBytes)")
            builder.withCustom(
                "clipboard-paste-protection",
                preferences.pasteProtection ? "true" : "false"
            )
        }
    }

    private func applyTerminalRuntimeConfiguration(window: NSWindow) {
        let windowId = ObjectIdentifier(window)
        controller(for: window).setTerminalConfiguration(
            Self.terminalConfiguration(
                from: terminalRuntimePreferences[windowId] ?? TerminalRuntimePreferences()
            )
        )
    }

    private func mutateTerminalRuntimePreferences(
        window: NSWindow,
        _ mutate: (inout TerminalRuntimePreferences) -> Void
    ) {
        let windowId = ObjectIdentifier(window)
        var preferences = terminalRuntimePreferences[windowId] ?? TerminalRuntimePreferences()
        mutate(&preferences)
        terminalRuntimePreferences[windowId] = preferences
        applyTerminalRuntimeConfiguration(window: window)
    }

    private func rememberLayout(
        panelId: String,
        contentView: NSView,
        nativeFrame: NSRect
    ) {
        if var existing = terminalLayouts[panelId] {
            existing.rememberAuthoritativeLayout(
                contentSize: contentView.bounds.size,
                frame: nativeFrame
            )
            terminalLayouts[panelId] = existing
            return
        }
        terminalLayouts[panelId] = TerminalLayoutState(
            authoritativeContentSize: contentView.bounds.size,
            authoritativeFrame: nativeFrame
        )
    }

    nonisolated static func configureDefaultTerminalAppearance(
        _ builder: inout TerminalConfiguration.Builder
    ) {
        let terminalPaddingX = 6
        let terminalPaddingY = 4
        builder.withBackgroundOpacity(1.0)
        builder.withWindowPaddingX(terminalPaddingX)
        builder.withWindowPaddingY(terminalPaddingY)
        builder.withCustom("scrollbar", "system")
        builder.withCustom("keybind", "super+backspace=text:\\x15")
        // Pier 负责光标形状偏好; Ghostty shell integration 默认会在 prompt 强制 bar。
        // 厚度调整走 Ghostty 全局字形度量: bar / 空心块光标会加粗, underline 同时影响
        // 下划线光标和 SGR-4 下划线文本; 为 HiDPI 可读性接受这个一致加粗。
        builder.withCustom("shell-integration-features", "no-cursor")
        builder.withCustom("adjust-cursor-thickness", "1")
        builder.withCustom("adjust-underline-thickness", "1")
        // 文字锐度: 在线性空间做边缘 alpha 混合并按字形亮度校正。macOS 默认 native 在
        // Display P3 空间混合, 会让深色底上的浅色字边缘偏暗/偏粗(显"肉"); linear-corrected
        // 去掉这层暗化又不像纯 linear 那样发细。见 ghostty alpha-blending 文档。
        builder.withCustom("alpha-blending", "linear-corrected")
    }

    nonisolated private static func terminalColor(from value: String) -> NSColor? {
        let hex = stripHash(value)
        guard hex.count == 6, let rgb = Int(hex, radix: 16) else { return nil }
        return NSColor(
            calibratedRed: CGFloat((rgb >> 16) & 0xff) / 255,
            green: CGFloat((rgb >> 8) & 0xff) / 255,
            blue: CGFloat(rgb & 0xff) / 255,
            alpha: 1
        )
    }

    nonisolated private static func terminalBackgroundColor(from value: String) -> NSColor? {
        terminalColor(from: value)
    }

    // MARK: - Window setup (PIER: new API)

    /// 一次性初始化: 创建 EventRouterView + WKWebView 透明化.
    /// browserWindowId 用于 keyboard forward 多窗口路由 (Electron BrowserWindow.id).
    func setupWindow(parent: NSWindow, browserWindowId: Int) -> Bool {
        guard let contentView = parent.contentView else { return false }
        let windowId = ObjectIdentifier(parent)

        // 防止重复初始化
        guard eventRouters[windowId] == nil else { return true }

        // 查找 WKWebView
        var wkWebView: NSView?
        for subview in contentView.subviews {
            if String(describing: type(of: subview)).contains("WKWebView")
                || String(describing: type(of: subview)).contains("WebContentsView") {
                wkWebView = subview
                break
            }
        }

        // WKWebView 透明化: 遍历 WebContentsViewCocoa 子视图找到真正的 WKWebView,
        // 设 drawsBackground=false + underPageBackgroundColor=clear, 确保 WKWebView
        // backing layer 真正按 web 内容 alpha 合成 (而非 opaque white fill 覆盖下层 NSView).
        //
        // 注意: drawsBackground 和 underPageBackgroundColor 是 WKWebView 的 private KVC.
        // macOS Sequoia+ 升级若改动 WKWebView 内部可能让 setValue 抛 NSException, swift
        // setValue 不能被 try 捕获 (它不 throws), 用 @objc try-catch wrapper 是 over-engineering.
        // 当前接受风险: 若未来 OS 移除这俩 KVC, app 启动 crash, 需通过 macOS support 矩阵
        // 控制和发版前烟测. 降级方案: BrowserWindow.transparent=true + setBackgroundColor
        // ("#00000000") 已设, 即使 WKWebView 仍 opaque, 至少透明渲染默认值是 clear.
        if let container = wkWebView {
            func findWKWebView(in view: NSView) -> NSView? {
                let typeName = String(describing: type(of: view))
                if typeName == "WKWebView" { return view }
                for child in view.subviews {
                    if let found = findWKWebView(in: child) { return found }
                }
                return nil
            }
            if let realWK = findWKWebView(in: container) {
                // 用 KVC 判断 key 是否存在 (responds(to:) 不一定 work for KVC),
                // setValue 失败会 NSException — swift 不能 catch, 但通过 valueClass /
                // 检查 attribute 存在性可以提前 short-circuit.
                let underPageKey = "underPageBackgroundColor"
                let drawsBgKey = "drawsBackground"
                if realWK.value(forKey: underPageKey) != nil
                    || (realWK as NSObject).responds(to: NSSelectorFromString("setUnderPageBackgroundColor:")) {
                    realWK.setValue(NSColor.clear, forKey: underPageKey)
                }
                if (realWK as NSObject).responds(to: NSSelectorFromString("setDrawsBackground:")) {
                    realWK.setValue(false, forKey: drawsBgKey)
                }
            }
        }

        // 创建 EventRouterView (最顶层), 同时绑定 keyboard 路由 (Cmd+key → WKWebView)
        let router = EventRouterView(frame: contentView.bounds)
        router.autoresizingMask = [.width, .height]
        contentView.addSubview(router, positioned: .above, relativeTo: nil)
        router.attachInputRouting(window: parent, browserWindowId: browserWindowId)
        eventRouters[windowId] = router

        // 记录 browserWindowId 映射 — PwdDelegate 反查 panel→window→browserId 路由 IPC.
        windowToBrowserWindowId[windowId] = browserWindowId

        return true
    }

    func applyWindowState(parent: NSWindow, json: String) -> NativeApplyResult {
        guard let data = json.data(using: .utf8),
              let state = try? JSONDecoder().decode(
                TerminalWindowStateEnvelope.self,
                from: data
              ),
              Self.isValidWindowState(state),
              let contentView = parent.contentView else {
            return .error
        }

        let windowId = ObjectIdentifier(parent)
        var applyState = windowApplyStates[windowId] ?? TerminalWindowApplyState()
        if state.nativeApplySequence < applyState.lastAppliedNativeApplySequence {
            applyState.staleDiscardCount += 1
            windowApplyStates[windowId] = applyState
            return .stale
        }
        if state.nativeApplySequence == applyState.lastAppliedNativeApplySequence {
            if let applied = appliedWindowStates[windowId] {
                applyFirstResponder(
                    for: parent,
                    targetPanelId: applied.keyboardTarget.terminalPanelId,
                    windowFocused: applied.windowFocused
                )
            }
            return .unchanged
        }

        var nextTargets: [String: EventRouterView.Target] = [:]
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for entry in state.terminals {
            guard var term = terminals[entry.panelId],
                  term.parentWindow === parent else { continue }
            if term.surfaceVisible != entry.visible {
                term.terminalView.setSurfaceVisible(entry.visible)
                term.surfaceVisible = entry.visible
                terminals[entry.panelId] = term
            }
            var viewport: NSRect?
            if let frame = entry.frame {
                let nextViewport = frame.nsRect
                viewport = nextViewport
                let nativeFrame = computeFrame(in: contentView, viewport: nextViewport)
                term.containerView.applyHostFrame(nativeFrame)
                rememberLayout(
                    panelId: entry.panelId,
                    contentView: contentView,
                    nativeFrame: nativeFrame
                )
            }

            if entry.visible, let viewport {
                contentView.addSubview(term.containerView, positioned: .below, relativeTo: nil)
                term.containerView.alphaValue = 1
                term.containerView.isHidden = false
                nextTargets[entry.panelId] = EventRouterView.Target(
                    rect: Self.terminalTargetRect(viewport: viewport),
                    view: term.containerView
                )
            } else {
                let rememberedFrame =
                    terminalLayouts[entry.panelId]?.presentedFrame ?? term.containerView.frame
                term.containerView.alphaValue = 0
                term.containerView.isHidden = true
                term.containerView.frame = NSRect(
                    x: -99999,
                    y: -99999,
                    width: rememberedFrame.width,
                    height: rememberedFrame.height
                )
            }
        }

        if let router = eventRouters[windowId] {
            router.targets = nextTargets
            router.webOverlayRects = state.webOverlayRects.map { $0.frame.nsRect }
            router.isHidden = Self.webOverlayRectsCoverRouter(router)
        }
        CATransaction.commit()

        appliedWindowStates[windowId] = state
        applyState.lastAppliedNativeApplySequence = state.nativeApplySequence
        applyState.lastAppliedRendererSequence = state.rendererSequence
        applyState.lastReason = state.reason
        windowApplyStates[windowId] = applyState
        applyFirstResponder(
            for: parent,
            targetPanelId: state.keyboardTarget.terminalPanelId,
            windowFocused: state.windowFocused
        )
        return .applied
    }

    private static func isValidWindowState(_ state: TerminalWindowStateEnvelope) -> Bool {
        guard state.nativeApplySequence > 0, state.rendererSequence >= 0 else { return false }
        let terminalIds = state.terminals.map(\.panelId)
        guard terminalIds.allSatisfy({ !$0.isEmpty }),
              Set(terminalIds).count == terminalIds.count,
              state.webOverlayRects.allSatisfy({ !$0.id.isEmpty }),
              Set(state.webOverlayRects.map(\.id)).count == state.webOverlayRects.count,
              state.terminals.allSatisfy({ entry in
                guard let frame = entry.frame else { return !entry.visible }
                return frame.x.isFinite && frame.y.isFinite
                    && frame.width.isFinite && frame.width >= 0
                    && frame.height.isFinite && frame.height >= 0
              }),
              state.webOverlayRects.allSatisfy({ entry in
                let frame = entry.frame
                return frame.x.isFinite && frame.y.isFinite
                    && frame.width.isFinite && frame.width >= 0
                    && frame.height.isFinite && frame.height >= 0
              }) else {
            return false
        }
        let focusedIds = state.terminals.filter(\.focused).map(\.panelId)
        if let targetPanelId = state.keyboardTarget.terminalPanelId {
            return state.keyboardTarget.kind == "terminal"
                && state.windowFocused
                && focusedIds == [targetPanelId]
                && terminalIds.contains(targetPanelId)
        }
        return state.keyboardTarget.kind == "web"
            && state.keyboardTarget.panelId == nil
            && focusedIds.isEmpty
    }

    private static func webOverlayRectsCoverRouter(_ router: EventRouterView) -> Bool {
        let bounds = router.bounds
        guard bounds.width > 0, bounds.height > 0 else { return false }
        let topLeft = NSPoint(x: bounds.minX, y: bounds.minY)
        let bottomRight = NSPoint(
            x: bounds.maxX - 0.5,
            y: bounds.maxY - 0.5
        )
        return router.webOverlayRects.contains {
            $0.contains(topLeft) && $0.contains(bottomRight)
        }
    }

    func activeTerminalPanelId(for window: NSWindow) -> String? {
        let state = appliedWindowStates[ObjectIdentifier(window)]
        guard state?.windowFocused == true else { return nil }
        return state?.keyboardTarget.terminalPanelId
    }

    func applyFirstResponder(
        for window: NSWindow,
        targetPanelId: String?,
        windowFocused: Bool
    ) {
        let activeTerminalId = windowFocused ? targetPanelId : nil
        let windowId = ObjectIdentifier(window)
        for (panelId, term) in terminals
            where ObjectIdentifier(term.parentWindow) == windowId {
            let hostKeyboardActive = panelId == activeTerminalId
            term.terminalView.hostKeyboardActive = hostKeyboardActive
            if hostKeyboardActive {
                term.terminalView.synchronizeHostFocusState()
            } else {
                _ = term.terminalView.resignFirstResponder()
            }
        }

        guard let activeTerminalId,
              let term = terminals[activeTerminalId] else { return }
        if window.firstResponder !== term.terminalView {
            window.makeFirstResponder(term.terminalView)
        }
        term.terminalView.synchronizeHostFocusState()
    }

    func prepareTerminalForOrdinaryKeyDown(
        window: NSWindow,
        event: NSEvent
    ) -> Bool {
        guard let panelId = activeTerminalPanelId(for: window),
              let term = terminals[panelId],
              term.terminalView.hostKeyboardActive else {
            return false
        }

        if window.firstResponder === term.terminalView {
            return false
        }

        guard window.makeFirstResponder(term.terminalView) else {
            return false
        }
        term.terminalView.synchronizeHostFocusState()
        term.terminalView.keyDown(with: event)
        return true
    }

    // Forward callback 注册 — 不经 GhosttyBridgeImpl 中间层. 整条 forward 链:
    //
    //   swift 输入 (NSEvent monitor / Ghostty delegate)
    //   → EventRouterView.forwardCmd­Key/RightMouseCallback (输入事件)
    //   或 TerminalEventDelegate.forwardPwd/TitleCallback (Ghostty 输出事件)
    //   → C 函数指针 trampoline (C ABI export 持有)
    //   → N-API ThreadSafeFunction (addon.mm 持有)
    //   → main JS callback → webContents.send → renderer.
    //
    // EventRouterView / TerminalEventDelegate 的 static var 就是 forward 的源头,
    // C ABI export 直接赋值过去 — 没有"impl method 转一层 static var"的中间步骤.

    // MARK: - Terminal lifecycle

    func createTerminal(
        parent: NSWindow,
        panelId: String,
        viewport: NSRect,
        fontFamily: String,
        fontSize: Float,
        workingDirectory: String?,
        command: String?,
        environment: [String: String],
        lifecycleId: String,
        hostManaged: Bool = false
    ) -> Bool {
        guard let contentView = parent.contentView else { return false }

        // Reload 复用路径:同 panelId 已存在且是同一 parent window 的, 不 close、
        // 不重建 — 只同步 frame + 重新 apply font + 重新挂 EventRouter target.
        // terminalView / PTY / session / 屏幕缓冲 全部保留, 用户看不到任何闪烁,
        // shell 状态 (运行中进程、命令历史、cwd) 完整跨 reload.
        //
        // parent 不一致的极少数情况 (panelId 在 Pier 中跨窗口非唯一, 见
        // TerminalEventDelegate 注释), 退回到原 defensive 行为:先 close 旧的
        // 再创建, 避免把别 window 的 terminalView frame 拽到当前 window.
        if let existing = terminals[panelId] {
            let existingHostManaged = existing.outputSession != nil
            if existing.parentWindow === parent,
               existingHostManaged == hostManaged {
                let frame = computeFrame(in: contentView, viewport: viewport)
                existing.containerView.applyHostFrame(frame)
                rememberLayout(
                    panelId: panelId,
                    contentView: contentView,
                    nativeFrame: frame
                )

                applyFontConfig(
                    window: parent,
                    fontFamily: fontFamily,
                    fontSize: fontSize
                )

                return true
            }
            close(panelId: panelId)
        }

        let frame = computeFrame(in: contentView, viewport: viewport)

        let terminalView = TerminalView(frame: .zero)
        terminalView.focusesOnMouseDown = false
        terminalView.hostKeyboardActive = false
        let outputSession = hostManaged
            ? InMemoryTerminalSession(write: { _ in }, resize: { _ in })
            : nil
        let backend: TerminalSessionBackend = outputSession.map {
            .inMemory($0)
        } ?? .exec
        terminalView.configuration = TerminalSurfaceOptions(
            backend: backend,
            command: command,
            environment: environment,
            workingDirectory: workingDirectory
        )
        terminalView.controller = controller(for: parent)

        // 把创建期字体写进 controller 的 TerminalConfiguration. 走 setTerminalConfiguration
        // → ghostty_app_update_config + ghostty_surface_update_config (hot-reload). 注意
        // 这是 window 级 config — 同 window 已存在的其他 panel 也会同步切到新字体
        // (ghostty_app_update_config 会推到 controller 下所有 surface). 实际使用中字体
        // 来自 store 单值 (monoFontFamily + monoFontSize), 每个 panel 都用同一份, 不会
        // 看到字体抖动; 但概念上要清楚: 不是 panel-local 配置.
        applyFontConfig(
            window: parent,
            fontFamily: fontFamily,
            fontSize: fontSize
        )

        // 挂 EventDelegate — 同时接 OSC 7 (PwdDelegate) + OSC 0/2 (TitleDelegate).
        // delegate 是 weak ref, Terminal struct strong-hold eventDelegate 保证生命周期.
        // browserWindowId 创建时固定 — panelId 跨窗口可能同名, 不能靠 panelId 全局反查.
        let parentWindowId = ObjectIdentifier(parent)
        let browserWindowId = windowToBrowserWindowId[parentWindowId] ?? -1
        let eventDelegate = TerminalEventDelegate(
            panelId: panelId,
            browserWindowId: browserWindowId,
            lifecycleId: lifecycleId
        )
        terminalView.delegate = eventDelegate

        // Container 负责把 Pier 的命中/焦点事件路由到 SPM AppKit 容器。
        // 滚动条由 libghostty-spm 内部的 NSScrollView 承接, Pier 不绘制滚动条。
        let container = TerminalContainerView(
            frame: frame,
            terminalView: terminalView,
            panelId: panelId,
            browserWindowId: browserWindowId
        )
        container.backgroundColor = terminalBackgrounds[parentWindowId] ?? .black
        eventDelegate.scrollbarSink = container

        // PIER: 放在所有 web 渲染相关 NSView 之下.
        // Electron 43 macOS contentView 实际结构 (subviews 从底到顶):
        //   [0] ViewsCompositorSuperview — Chromium GPU compositor, 真正渲染 web 内容
        //   [1] WebContentsViewCocoa     — Electron 的空 wrapper
        //   [2] EventRouterView          — 我们的 hit-test 顶层
        // 旧逻辑: addSubview .below relativeTo WebContentsViewCocoa → container 进入
        //   subviews[1], 视觉上 cover 了 ViewsCompositorSuperview, terminal 遮挡 web.
        // 正确: .below relativeTo nil → 插入 subviews[0], 在 ViewsCompositorSuperview
        //   之下 (visually 最底), web 层可叠加在 terminal 之上.
        container.alphaValue = 0
        container.isHidden = true
        container.frame = NSRect(
            x: -99999, y: -99999, width: frame.width, height: frame.height
        )
        contentView.addSubview(container, positioned: .below, relativeTo: nil)

        terminals[panelId] = Terminal(
            containerView: container,
            terminalView: terminalView,
            parentWindow: parent,
            outputSession: outputSession,
            eventDelegate: eventDelegate,
            surfaceVisible: false
        )
        rememberLayout(
            panelId: panelId,
            contentView: contentView,
            nativeFrame: frame
        )


        return true
    }

    func writeOutput(panelId: String, data: Data) -> Bool {
        guard let session = terminals[panelId]?.outputSession else {
            return false
        }
        session.receive(data)
        return true
    }

    func finishOutput(
        panelId: String,
        exitCode: UInt32,
        runtimeMilliseconds: UInt64
    ) -> Bool {
        guard let session = terminals[panelId]?.outputSession else {
            return false
        }
        session.finish(
            exitCode: exitCode,
            runtimeMilliseconds: runtimeMilliseconds
        )
        return true
    }

    /// 为同一个逻辑 Task Output panel 创建全新的 host-managed surface。
    ///
    /// Ghostty 的 process-exit 状态不可逆，因此重新运行不能继续向已 finish 的
    /// InMemoryTerminalSession 追加。这里在 MainActor 的同一次调用中替换原生视图，
    /// 并恢复原几何与可见性；dockview panel 本身不销毁、不换组、不换位置。
    func resetOutput(panelId: String) -> Bool {
        guard let term = terminals[panelId],
              term.outputSession != nil,
              let contentView = term.parentWindow.contentView,
              let layout = terminalLayouts[panelId]
        else {
            return false
        }

        let parent = term.parentWindow
        let nativeFrame = layout.authoritativeFrame
        let viewport = NSRect(
            x: nativeFrame.minX,
            y: contentView.bounds.height - nativeFrame.maxY,
            width: nativeFrame.width,
            height: nativeFrame.height
        )
        let preferences = terminalRuntimePreferences[ObjectIdentifier(parent)]
            ?? TerminalRuntimePreferences()
        let fontFamily = preferences.fontFamilies.isEmpty
            ? "Menlo"
            : preferences.fontFamilies.joined(separator: "\n")
        let fontSize = preferences.fontSize > 0 ? preferences.fontSize : 13
        let wasVisible = term.surfaceVisible

        close(panelId: panelId)
        let created = createTerminal(
            parent: parent,
            panelId: panelId,
            viewport: viewport,
            fontFamily: fontFamily,
            fontSize: fontSize,
            workingDirectory: nil,
            command: nil,
            environment: [:],
            lifecycleId: "",
            hostManaged: true
        )
        if created && wasVisible {
            show(panelId: panelId)
        }
        return created
    }


    private func show(panelId: String) {
        guard var term = terminals[panelId] else { return }
        if !term.surfaceVisible {
            term.terminalView.setSurfaceVisible(true)
            term.surfaceVisible = true
            terminals[panelId] = term
        }
        if let contentView = term.parentWindow.contentView {
            // 确保终端在所有 web 渲染层之下 (见 createTerminal 注释)
            contentView.addSubview(term.containerView, positioned: .below, relativeTo: nil)
        }

        let frame = terminalLayouts[panelId]?.presentedFrame ?? term.containerView.frame
        term.containerView.applyHostFrame(frame)

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        term.containerView.alphaValue = 1
        term.containerView.isHidden = false
        CATransaction.commit()
    }


    @discardableResult
    func close(panelId: String) -> Bool {
        guard let term = terminals[panelId] else { return false }
        let parent = term.parentWindow
        term.containerView.removeFromSuperview()
        terminals.removeValue(forKey: panelId)
        terminalLayouts.removeValue(forKey: panelId)

        let windowId = ObjectIdentifier(parent)
        eventRouters[windowId]?.targets.removeValue(forKey: panelId)

        return true
    }

    // MARK: - Test-only window transfer (spike)
    //
    // Minimal same-surface reparent for Task 1 gate. Formal production API
    // converges in step 6 (scoped keys + journaled ownership move). Do not call
    // from product paths.

    struct TerminalIdentityForTests {
        let browserWindowId: Int
        let containerView: TerminalContainerView
        let controller: TerminalController?
        let parentWindow: NSWindow
        let surfaceGeneration: UInt64
        let terminalView: TerminalView
    }

    func terminalIdentityForTests(panelId: String) -> TerminalIdentityForTests? {
        guard let term = terminals[panelId] else { return nil }
        return TerminalIdentityForTests(
            browserWindowId: term.eventDelegate.browserWindowId,
            containerView: term.containerView,
            controller: term.terminalView.controller,
            parentWindow: term.parentWindow,
            surfaceGeneration: term.terminalView.pierRenderDiagnostics.surfaceGeneration,
            terminalView: term.terminalView
        )
    }

    func controllerForTests(window: NSWindow) -> TerminalController? {
        controllers[ObjectIdentifier(window)]
    }

    func routerHasTargetForTests(window: NSWindow, panelId: String) -> Bool {
        eventRouters[ObjectIdentifier(window)]?.targets[panelId] != nil
    }

    /// Reparent an existing terminal container/view to another NSWindow without
    /// rebuilding the Ghostty surface or restarting the PTY.
    ///
    /// Critical: `TerminalView.controller` must keep the **same object**. Assigning
    /// a different `TerminalController` tears down and rebuilds the surface.
    @discardableResult
    func transferTerminalForTests(
        panelId: String,
        to targetWindow: NSWindow,
        toBrowserWindowId: Int,
        viewport: NSRect
    ) -> Bool {
        guard var term = terminals[panelId],
              let sourceContent = term.parentWindow.contentView,
              let targetContent = targetWindow.contentView,
              eventRouters[ObjectIdentifier(targetWindow)] != nil
        else {
            return false
        }

        let sourceWindow = term.parentWindow
        guard sourceWindow !== targetWindow else { return true }

        // Target must not already own this panelId (stable IDs; conflict = fail).
        if let existing = terminals[panelId], existing.parentWindow === targetWindow {
            return false
        }

        let sourceWindowId = ObjectIdentifier(sourceWindow)
        let targetWindowId = ObjectIdentifier(targetWindow)

        // Snapshot for rollback.
        let previousSuperview = term.containerView.superview
        let previousFrame = term.containerView.frame
        let previousHidden = term.containerView.isHidden
        let previousAlpha = term.containerView.alphaValue
        let previousParent = term.parentWindow
        let previousBrowserId = term.eventDelegate.browserWindowId
        let previousController = term.terminalView.controller
        let previousSourceController = controllers[sourceWindowId]
        let previousTargetController = controllers[targetWindowId]
        let previousSourceTarget = eventRouters[sourceWindowId]?.targets[panelId]
        let previousLayout = terminalLayouts[panelId]

        func restore() {
            term.containerView.removeFromSuperview()
            if let previousSuperview {
                previousSuperview.addSubview(
                    term.containerView,
                    positioned: .below,
                    relativeTo: nil
                )
            }
            term.containerView.frame = previousFrame
            term.containerView.isHidden = previousHidden
            term.containerView.alphaValue = previousAlpha
            term.parentWindow = previousParent
            term.eventDelegate.browserWindowId = previousBrowserId
            term.containerView.updateBrowserWindowId(previousBrowserId)
            // Keep controller object identical to avoid surface rebuild.
            if term.terminalView.controller !== previousController {
                term.terminalView.controller = previousController
            }
            controllers[sourceWindowId] = previousSourceController
            if let previousTargetController {
                controllers[targetWindowId] = previousTargetController
            } else {
                controllers.removeValue(forKey: targetWindowId)
            }
            if let previousSourceTarget {
                eventRouters[sourceWindowId]?.targets[panelId] = previousSourceTarget
            } else {
                eventRouters[sourceWindowId]?.targets.removeValue(forKey: panelId)
            }
            eventRouters[targetWindowId]?.targets.removeValue(forKey: panelId)
            terminalLayouts[panelId] = previousLayout
            terminals[panelId] = term
        }

        // 1) Drop source router target first so hits stop routing to the old window.
        eventRouters[sourceWindowId]?.targets.removeValue(forKey: panelId)

        // 2) Move per-window controller ownership to the target WITHOUT changing
        //    the TerminalView.controller object identity.
        let movingController = term.terminalView.controller
            ?? controllers[sourceWindowId]
        if let movingController {
            // Target must not already host a different controller with live terminals.
            if let existingTargetController = controllers[targetWindowId],
               existingTargetController !== movingController
            {
                let targetHasOtherTerminals = terminals.contains {
                    $0.key != panelId
                        && ObjectIdentifier($0.value.parentWindow) == targetWindowId
                }
                if targetHasOtherTerminals {
                    restore()
                    return false
                }
            }
            controllers[targetWindowId] = movingController
            if controllers[sourceWindowId] === movingController {
                controllers.removeValue(forKey: sourceWindowId)
            }
            // Only assign if different — assignment rebuilds surface.
            if term.terminalView.controller !== movingController {
                term.terminalView.controller = movingController
            }
        }

        // 3) Reparent the same container/view under target contentView (bottom).
        let targetFrame = computeFrame(in: targetContent, viewport: viewport)
        term.containerView.removeFromSuperview()
        term.containerView.isHidden = true
        term.containerView.alphaValue = 0
        term.containerView.frame = NSRect(
            x: -99999,
            y: -99999,
            width: targetFrame.width,
            height: targetFrame.height
        )
        targetContent.addSubview(term.containerView, positioned: .below, relativeTo: nil)

        // 4) Update ownership + browser ids on delegate/container.
        term.parentWindow = targetWindow
        term.eventDelegate.browserWindowId = toBrowserWindowId
        term.containerView.updateBrowserWindowId(toBrowserWindowId)
        windowToBrowserWindowId[targetWindowId] = toBrowserWindowId

        // 5) Remember layout + install target router hit target.
        rememberLayout(
            panelId: panelId,
            contentView: targetContent,
            nativeFrame: targetFrame
        )
        eventRouters[targetWindowId]?.targets[panelId] = EventRouterView.Target(
            rect: Self.terminalTargetRect(viewport: viewport),
            view: term.containerView
        )

        // 6) Present on target with the same surface (unhide).
        term.containerView.applyHostFrame(targetFrame)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        term.containerView.alphaValue = 1
        term.containerView.isHidden = false
        CATransaction.commit()

        // Ensure surface stays marked visible after move.
        if !term.surfaceVisible {
            term.terminalView.setSurfaceVisible(true)
            term.surfaceVisible = true
        }

        terminals[panelId] = term

        // Basic integrity: still attached to target, controller object unchanged.
        if term.containerView.superview !== targetContent
            || term.terminalView.controller !== movingController
            && movingController != nil
        {
            restore()
            return false
        }

        // Silence unused source content warning in optimized builds.
        _ = sourceContent
        return true
    }

    func performBindingAction(panelId: String, action: String) -> Bool {
        guard let term = terminals[panelId] else { return false }
        return term.terminalView.performBindingAction(action)
    }

    func readSelectionText(panelId: String) -> String? {
        guard let term = terminals[panelId] else { return nil }
        return term.terminalView.readSelectionText()
    }

    func sendText(panelId: String, text: String) -> Bool {
        guard let term = terminals[panelId] else { return false }
        return term.terminalView.sendText(text)
    }

    /// 孤儿清理:关掉该 window 下不在 activeIds 集合中的 terminal NSView. 配合
    /// C 方案 reload 零销毁使用 — renderer 重建后调 reconcile 报告"我现在还需要
    /// 这些 panelId", main 转给这里, 把 reload 前 layout 里有但新 layout 没有
    /// 的 panel 清掉, 避免孤儿 NSView 永久挂在 contentView.subviews 中.
    /// activeIds 为空表示新 renderer 还没有任何 terminal panel, 全部清掉.
    func reconcile(parent: NSWindow, activeIds: Set<String>) {
        let windowId = ObjectIdentifier(parent)
        let toClose = terminals.filter { (panelId, term) in
            ObjectIdentifier(term.parentWindow) == windowId && !activeIds.contains(panelId)
        }
        for (panelId, _) in toClose {
            close(panelId: panelId)
        }
    }

    /// 关闭指定 window 下所有 terminal NSView. 用于 renderer reload / crash 时清理,
    /// 防止旧 NSView 残留在 contentView.subviews 中导致与新 renderer 创建的 panel
    /// id 冲突或 layer 泄漏. 注意: 不 detach EventRouter (window 还在, 后续 renderer
    /// 重新 create panel 时仍需要 router routing); detach 走 detachWindow().
    func closeAll(parent: NSWindow) {
        let windowId = ObjectIdentifier(parent)
        let toClose = terminals.filter { ObjectIdentifier($0.value.parentWindow) == windowId }
        for (panelId, term) in toClose {
            term.containerView.removeFromSuperview()
            terminals.removeValue(forKey: panelId)
            terminalLayouts.removeValue(forKey: panelId)
        }
        eventRouters[windowId]?.targets.removeAll()
    }

    /// Window 被关闭时的完全清理: closeAll + EventRouter 移除 + monitor 卸载 + 字典
    /// 删除. 必须在 NSWindow 真销毁时调用一次 (Electron main 的 window.on("closed")),
    /// 防止 NSEvent application-level monitor 泄漏 + GhosttyBridgeImpl singleton 字典
    /// 膨胀.
    ///
    /// 与 closeAll() 区别: closeAll 只清 terminals (reload 场景, window 还在);
    /// detachWindow 把 window-scoped 所有资源全部清掉 (window close 场景).
    func detachWindow(parent: NSWindow) {
        let windowId = ObjectIdentifier(parent)
        closeAll(parent: parent)
        if let router = eventRouters[windowId] {
            router.detachInputRouting()
            router.removeFromSuperview()
            eventRouters.removeValue(forKey: windowId)
        }
        // 释放该 window 的 TerminalController — 内部 session/PTY 列表跨 window 累积
        // 是潜在内存泄漏, swift ARC 让无引用 controller 自动 dealloc.
        controllers.removeValue(forKey: windowId)
        terminalBackgrounds.removeValue(forKey: windowId)
        terminalRuntimePreferences.removeValue(forKey: windowId)
        appliedWindowStates.removeValue(forKey: windowId)
        windowApplyStates.removeValue(forKey: windowId)
        windowToBrowserWindowId.removeValue(forKey: windowId)
    }

    // MARK: - Theme apply

    /// 把 Pier 主题派生的终端配色应用到该 window 下的 Ghostty controller. 走库的
    /// `controller.setTheme(...)` 路径, 内部 reconfigure 并 push 到 ghostty app, shell
    /// 进程不重启. 一个 controller 服务 window 下所有 terminal panel.
    ///
    /// controller(for:) 是 lazy 创建 — 即使 applyTheme 在 createTerminal 之前调
    /// (主题 hydrate 顺序在前), 也会 cache 主题; 后续 createTerminal 拿到的是已经
    /// 应用了主题的 controller, terminalView 创建即正确配色.
    func applyTheme(
        window: NSWindow,
        background: String,
        foreground: String,
        cursor: String?,
        selectionBackground: String?,
        selectionForeground: String?,
        palette: [Int: String]
    ) {
        let controller = controller(for: window)
        let definition = GhosttyThemeDefinition(
            name: "pier-runtime",
            background: background,
            foreground: foreground,
            cursorColor: cursor,
            cursorText: nil,
            selectionBackground: selectionBackground,
            selectionForeground: selectionForeground,
            palette: palette
        )
        controller.setTheme(definition.toTerminalTheme())
        if let backgroundColor = Self.terminalBackgroundColor(from: background) {
            let windowId = ObjectIdentifier(window)
            terminalBackgrounds[windowId] = backgroundColor
            for term in terminals.values where term.parentWindow === window {
                term.containerView.backgroundColor = backgroundColor
            }
        }
    }

    /// 把字体配置写入 window 下的 TerminalController. 走 setTerminalConfiguration
    /// → ghostty_app_update_config + ghostty_surface_update_config (hot-reload),
    /// 不重建 surface 不杀 shell. controller 是 lazy 创建 — 即使 setFont 在 createTerminal
    /// 之前调 (字体 hydrate 顺序在前), 后续 createTerminal 拿到的 controller 已带字体配置.
    func applyFontConfig(
        window: NSWindow,
        fontFamily: String,
        fontSize: Float
    ) {
        let families = fontFamily.split(separator: "\n").map(String.init)
        // 防止非 renderer 调用方传空字符串导致 ghostty 完全无 font-family.
        let safe = families.isEmpty ? ["Menlo"] : families
        mutateTerminalRuntimePreferences(window: window) { preferences in
            preferences.fontFamilies = safe
            preferences.fontSize = fontSize
        }
    }

    func applyTerminalConfig(
        window: NSWindow,
        cursorStyleRaw: String,
        cursorBlink: Bool,
        scrollbackLimitBytes: UInt64,
        pasteProtection: Bool
    ) {
        mutateTerminalRuntimePreferences(window: window) { preferences in
            preferences.cursorStyle = Self.cursorStyle(from: cursorStyleRaw)
            preferences.cursorBlink = cursorBlink
            preferences.scrollbackLimitBytes = scrollbackLimitBytes
            preferences.pasteProtection = pasteProtection
        }
    }

    private static func cursorStyle(from raw: String) -> TerminalCursorStyle {
        switch raw {
        case "bar":
            return .bar
        case "underline":
            return .underline
        default:
            return .block
        }
    }

    /// EventRouterView.targets[panelId].rect 用的坐标系是 EventRouterView 自己 — 它
    /// override isFlipped=true 走 top-left, 等价于 BrowserWindow contentView 坐标.
    /// 这里的 viewport 已经在 renderer 侧乘过 Electron page zoom. **必须传 viewport
    /// (top-left), 不是 NSView frame** — frame 是 contentView 坐标 (bottom-left, 经
    /// computeFrame Y-flip 后的), 两者不一致.
    ///
    /// 历史 bug:之前传 frame, hitTest 在 panel 偏离垂直中心时 miss — 因 contentView
    /// (bottom-left) 跟 EventRouterView (top-left) 的 Y range 数字只在 panel 上下对称
    /// 于 H/2 时巧合相等, drag panel 到非中央位置后 hitTest 就 silent miss, 点击落到
    /// web 层但无 listener → click 无效, 用户感受"无法 click 终端 / 无法输入".
    private static func terminalTargetRect(viewport: NSRect) -> NSRect {
        viewport.insetBy(dx: hitInset, dy: hitInset)
    }

    private static func rectDebugPayload(_ rect: NSRect) -> [String: Double] {
        [
            "height": Double(rect.height),
            "width": Double(rect.width),
            "x": Double(rect.minX),
            "y": Double(rect.minY),
        ]
    }

    private static func viewportDebugRect(contentView: NSView, frame: NSRect) -> NSRect {
        if contentView.isFlipped {
            return frame
        }
        return NSRect(
            x: frame.minX,
            y: contentView.bounds.height - frame.minY - frame.height,
            width: frame.width,
            height: frame.height
        )
    }

    /// 失败时返回明确带 error 的对象 (而不是 "{}"), 让 main 侧 normalize 能识别
    /// "整个 snapshot 序列化失败" 而不是把它当成 healthy-empty snapshot 静默展示。
    private static func jsonString(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8) else {
            return "{\"error\":\"native snapshot json serialization failed\"}"
        }
        return json
    }

    func debugSnapshot(parent: NSWindow) -> String {
        let windowId = ObjectIdentifier(parent)
        let appliedState = appliedWindowStates[windowId]
        let router = eventRouters[windowId]
        let activeTerminalPanelId: Any =
            activeTerminalPanelId(for: parent).map { $0 as Any } ?? NSNull()
        let applyState = windowApplyStates[windowId]
        let browserWindowId = windowToBrowserWindowId[windowId] ?? -1
        let contentView = parent.contentView
        let surfaces: [[String: Any]] = terminals
            .filter { ObjectIdentifier($0.value.parentWindow) == windowId }
            .sorted { $0.key < $1.key }
            .map { panelId, term in
                let frame = term.containerView.frame
                let render = term.terminalView.pierRenderDiagnostics
                var payload: [String: Any] = [
                    "alpha": Double(term.containerView.alphaValue),
                    "browserWindowId": browserWindowId,
                    "cursorSuppressed": term.terminalView.cursorSuppressed,
                    "drawPending": render.drawPending,
                    "drawSequence": Double(render.drawSequence),
                    "frame": Self.rectDebugPayload(frame),
                    "ghosttyRenderReadySequence": Double(
                        render.ghosttyRenderReadySequence
                    ),
                    "hasRouterTarget": router?.targets[panelId] != nil,
                    "hostRefreshRequestSequence": Double(
                        render.hostRefreshRequestSequence
                    ),
                    "hostKeyboardActive": term.terminalView.hostKeyboardActive,
                    "isFirstResponder": parent.firstResponder === term.terminalView,
                    "isHidden": term.containerView.isHidden,
                    "isOffscreen": frame.minX < -50000 || frame.minY < -50000,
                    "isSurfaceFocused": term.eventDelegate.isSurfaceFocused,
                    "lastDrawnGhosttyRenderReadySequence": Double(
                        render.lastDrawnGhosttyRenderReadySequence
                    ),
                    "panelId": panelId,
                    "refreshPending": render.refreshPending,
                    "surfaceVisible": term.surfaceVisible,
                    "surfaceGeneration": Double(render.surfaceGeneration),
                ]
                if let lastDrawUptime = render.lastDrawUptime {
                    payload["lastDrawUptime"] = lastDrawUptime
                }
                if let lastRenderReadyUptime = render.lastRenderReadyUptime {
                    payload["lastRenderReadyUptime"] = lastRenderReadyUptime
                }
                if let contentView {
                    payload["viewportFrame"] = Self.rectDebugPayload(
                        Self.viewportDebugRect(contentView: contentView, frame: frame)
                    )
                }
                if let target = router?.targets[panelId] {
                    payload["targetRect"] = Self.rectDebugPayload(target.rect)
                }
                return payload
            }

        var windowPayload: [String: Any] = [
            "activeTerminalPanelId": activeTerminalPanelId,
            "keyboardFocusTarget":
                appliedState?.keyboardTarget.debugPayload ?? ["kind": "web"],
            "lastAppliedNativeApplySequence":
                applyState?.lastAppliedNativeApplySequence ?? 0,
            "lastAppliedRendererSequence":
                applyState?.lastAppliedRendererSequence ?? 0,
            "lastWindowStateReason": applyState?.lastReason ?? "",
            "recentRouterDecisions": router?.snapshotRecentDecisions() ?? [],
            "staleDiscardCount": applyState?.staleDiscardCount ?? 0,
            "terminalTargetCount": router?.targets.count ?? 0,
            "webOverlayRectCount": router?.webOverlayRects.count ?? 0,
        ]
        if let controllerDiagnostics = controllers[windowId]?.pierDiagnostics {
            windowPayload["appTickCount"] = Double(controllerDiagnostics.appTickCount)
            if let lastAppTickUptime = controllerDiagnostics.lastAppTickUptime {
                windowPayload["lastAppTickUptime"] = lastAppTickUptime
            }
        }
        let snapshot: [String: Any] = [
            "surfaces": surfaces,
            "window": windowPayload,
        ]
        return Self.jsonString(snapshot)
    }

    // MARK: - Coordinate conversion

    private func computeFrame(in contentView: NSView, viewport: NSRect) -> NSRect {
        if contentView.isFlipped {
            return viewport
        }
        return NSRect(
            x: viewport.minX,
            y: contentView.bounds.height - viewport.minY - viewport.height,
            width: viewport.width,
            height: viewport.height
        )
    }
}

// MARK: - C ABI exports

@_cdecl("ghostty_bridge_setup_window")
public func ghosttyBridgeSetupWindow(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ browserWindowId: Int
) -> Bool {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        return GhosttyBridgeImpl.shared.setupWindow(
            parent: window, browserWindowId: browserWindowId
        )
    }
}

@_cdecl("ghostty_bridge_create_terminal")
public func ghosttyBridgeCreateTerminal(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ panelIdPtr: UnsafePointer<CChar>,
    _ x: Double, _ y: Double, _ w: Double, _ h: Double,
    _ fontFamilyPtr: UnsafePointer<CChar>,
    _ fontSize: Float,
    _ workingDirectoryPtr: UnsafePointer<CChar>?,
    _ commandPtr: UnsafePointer<CChar>?,
    _ envKeysPtr: UnsafePointer<UnsafePointer<CChar>?>?,
    _ envValuesPtr: UnsafePointer<UnsafePointer<CChar>?>?,
    _ envCount: Int,
    _ lifecycleIdPtr: UnsafePointer<CChar>
) -> Bool {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        let panelId = String(cString: panelIdPtr)
        let fontFamily = String(cString: fontFamilyPtr)
        let workingDirectory = workingDirectoryPtr.map { String(cString: $0) }
        let command = commandPtr.map { String(cString: $0) }
        var environment: [String: String] = [:]
        if let envKeysPtr, let envValuesPtr, envCount > 0 {
            for index in 0 ..< envCount {
                guard let keyPtr = envKeysPtr[index],
                      let valuePtr = envValuesPtr[index]
                else { continue }
                environment[String(cString: keyPtr)] = String(cString: valuePtr)
            }
        }
        let viewport = NSRect(x: x, y: y, width: w, height: h)
        return GhosttyBridgeImpl.shared.createTerminal(
            parent: window,
            panelId: panelId,
            viewport: viewport,
            fontFamily: fontFamily,
            fontSize: fontSize,
            workingDirectory: workingDirectory,
            command: command,
            environment: environment,
            lifecycleId: String(cString: lifecycleIdPtr)
        )
    }
}

@_cdecl("ghostty_bridge_create_output_terminal")
public func ghosttyBridgeCreateOutputTerminal(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ panelIdPtr: UnsafePointer<CChar>,
    _ x: Double, _ y: Double, _ w: Double, _ h: Double,
    _ fontFamilyPtr: UnsafePointer<CChar>,
    _ fontSize: Float
) -> Bool {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        return GhosttyBridgeImpl.shared.createTerminal(
            parent: window,
            panelId: String(cString: panelIdPtr),
            viewport: NSRect(x: x, y: y, width: w, height: h),
            fontFamily: String(cString: fontFamilyPtr),
            fontSize: fontSize,
            workingDirectory: nil,
            command: nil,
            environment: [:],
            lifecycleId: "",
            hostManaged: true
        )
    }
}

@_cdecl("ghostty_bridge_write_output")
public func ghosttyBridgeWriteOutput(
    _ panelIdPtr: UnsafePointer<CChar>,
    _ bytes: UnsafePointer<UInt8>?,
    _ count: Int
) -> Bool {
    guard let bytes, count > 0 else { return true }
    let data = Data(bytes: bytes, count: count)
    return MainActor.assumeIsolated {
        GhosttyBridgeImpl.shared.writeOutput(
            panelId: String(cString: panelIdPtr),
            data: data
        )
    }
}

@_cdecl("ghostty_bridge_finish_output")
public func ghosttyBridgeFinishOutput(
    _ panelIdPtr: UnsafePointer<CChar>,
    _ exitCode: UInt32,
    _ runtimeMilliseconds: UInt64
) -> Bool {
    MainActor.assumeIsolated {
        GhosttyBridgeImpl.shared.finishOutput(
            panelId: String(cString: panelIdPtr),
            exitCode: exitCode,
            runtimeMilliseconds: runtimeMilliseconds
        )
    }
}

@_cdecl("ghostty_bridge_reset_output")
public func ghosttyBridgeResetOutput(
    _ panelIdPtr: UnsafePointer<CChar>
) -> Bool {
    MainActor.assumeIsolated {
        GhosttyBridgeImpl.shared.resetOutput(
            panelId: String(cString: panelIdPtr)
        )
    }
}

@_cdecl("ghostty_bridge_set_font_config")
public func ghosttyBridgeSetFontConfig(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ fontFamilyPtr: UnsafePointer<CChar>,
    _ fontSize: Float
) {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        let fontFamily = String(cString: fontFamilyPtr)
        GhosttyBridgeImpl.shared.applyFontConfig(
            window: window,
            fontFamily: fontFamily,
            fontSize: fontSize
        )
    }
}

/// 把打包字体 ttf 注册给当前进程的 CoreText (.process scope, 不污染系统字体库),
/// 让 ghostty 能按 font-family 找到这些非系统字体. 启动时调一次.
/// 路径数组过 C 边界用 `\n` join 成单个字符串, 这里 split 还原.
@_cdecl("ghostty_bridge_register_fonts")
public func ghosttyBridgeRegisterFonts(_ pathsPtr: UnsafePointer<CChar>) {
    let joined = String(cString: pathsPtr)
    let paths = joined.split(separator: "\n").map(String.init)
    var registered = 0
    for path in paths where !path.isEmpty {
        let url = URL(fileURLWithPath: path) as CFURL
        var errorRef: Unmanaged<CFError>?
        let ok = CTFontManagerRegisterFontsForURL(url, .process, &errorRef)
        if ok {
            registered += 1
        } else {
            let desc = errorRef?.takeRetainedValue().localizedDescription ?? "unknown"
            NSLog("[ghostty-bridge] register font failed: \(path) — \(desc)")
        }
    }
    NSLog("[ghostty-bridge] registered \(registered)/\(paths.count) bundled fonts")
}

@_cdecl("ghostty_bridge_set_terminal_config")
public func ghosttyBridgeSetTerminalConfig(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ cursorStylePtr: UnsafePointer<CChar>,
    _ cursorBlink: Bool,
    _ scrollbackLimitBytes: Double,
    _ pasteProtection: Bool
) {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        let cursorStyle = String(cString: cursorStylePtr)
        GhosttyBridgeImpl.shared.applyTerminalConfig(
            window: window,
            cursorStyleRaw: cursorStyle,
            cursorBlink: cursorBlink,
            scrollbackLimitBytes: UInt64(max(0, scrollbackLimitBytes)),
            pasteProtection: pasteProtection
        )
    }
}


@_cdecl("ghostty_bridge_close")
public func ghosttyBridgeClose(_ panelId: UnsafePointer<CChar>) -> Bool {
    MainActor.assumeIsolated {
        return GhosttyBridgeImpl.shared.close(panelId: String(cString: panelId))
    }
}

@_cdecl("ghostty_bridge_perform_binding_action")
public func ghosttyBridgePerformBindingAction(
    _ panelId: UnsafePointer<CChar>,
    _ action: UnsafePointer<CChar>
) -> Bool {
    MainActor.assumeIsolated {
        GhosttyBridgeImpl.shared.performBindingAction(
            panelId: String(cString: panelId),
            action: String(cString: action)
        )
    }
}

@_cdecl("ghostty_bridge_send_text")
public func ghosttyBridgeSendText(
    _ panelId: UnsafePointer<CChar>,
    _ text: UnsafePointer<CChar>
) -> Bool {
    MainActor.assumeIsolated {
        GhosttyBridgeImpl.shared.sendText(
            panelId: String(cString: panelId),
            text: String(cString: text)
        )
    }
}

@_cdecl("ghostty_bridge_read_selection_text")
public func ghosttyBridgeReadSelectionText(
    _ panelId: UnsafePointer<CChar>
) -> UnsafeMutablePointer<CChar>? {
    let text = MainActor.assumeIsolated {
        GhosttyBridgeImpl.shared.readSelectionText(panelId: String(cString: panelId))
    }
    return text?.withCString { strdup($0) }
}

@_cdecl("ghostty_bridge_close_all")
public func ghosttyBridgeCloseAll(_ nsWindowPtr: UnsafeMutableRawPointer) {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        GhosttyBridgeImpl.shared.closeAll(parent: window)
    }
}

@_cdecl("ghostty_bridge_reconcile")
public func ghosttyBridgeReconcile(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ activeIds: UnsafePointer<UnsafePointer<CChar>?>?,
    _ count: Int
) {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        var ids: Set<String> = []
        if let activeIds = activeIds {
            for i in 0..<count {
                if let ptr = activeIds[i] {
                    ids.insert(String(cString: ptr))
                }
            }
        }
        GhosttyBridgeImpl.shared.reconcile(parent: window, activeIds: ids)
    }
}

@_cdecl("ghostty_bridge_detach_window")
public func ghosttyBridgeDetachWindow(_ nsWindowPtr: UnsafeMutableRawPointer) {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        GhosttyBridgeImpl.shared.detachWindow(parent: window)
    }
}

@_cdecl("ghostty_bridge_debug_snapshot")
public func ghosttyBridgeDebugSnapshot(
    _ nsWindowPtr: UnsafeMutableRawPointer
) -> UnsafeMutablePointer<CChar>? {
    let json = MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        return GhosttyBridgeImpl.shared.debugSnapshot(parent: window)
    }
    return json.withCString { strdup($0) }
}

@_cdecl("ghostty_bridge_free_string")
public func ghosttyBridgeFreeString(_ ptr: UnsafeMutablePointer<CChar>?) {
    if let ptr {
        free(ptr)
    }
}

// C 函数指针 typealias 集中放在一起 — addon.mm 通过 ThreadSafeFunction 包装让
// JS 端能安全接收. C string 在 @_cdecl 内 withCString 取临时指针调用 cb, cb 返回
// 后字符串生命周期结束 (addon.mm 端 trampoline 已 std::string 拷贝, 不会 dangling).
public typealias CommandStartedForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, UnsafePointer<CChar>, UnsafePointer<CChar>) -> Void
public typealias KeyboardForwardCallback = @convention(c) (Int, UInt, UnsafePointer<CChar>) -> Void
public typealias ModifierForwardCallback = @convention(c) (Int, UInt) -> Void
public typealias MouseForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, Double, Double) -> Void
public typealias TerminalFocusRequestCallback = @convention(c) (Int, UnsafePointer<CChar>) -> Void
public typealias PwdForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, UnsafePointer<CChar>) -> Void
public typealias OpenUrlForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, UnsafePointer<CChar>, UnsafePointer<CChar>) -> Void
public typealias SearchForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, Int, Int) -> Void
public typealias TitleForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, UnsafePointer<CChar>, UnsafePointer<CChar>) -> Void
public typealias CommandFinishedForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, UnsafePointer<CChar>, Int, UInt64) -> Void
public typealias ProcessClosedForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, UnsafePointer<CChar>, Bool) -> Void

@_cdecl("ghostty_bridge_set_keyboard_forward_callback")
public func ghosttyBridgeSetKeyboardForwardCallback(_ cb: KeyboardForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            EventRouterView.forwardCmdKeyCallback = { wid, mods, chars in
                chars.withCString { ptr in cb(wid, mods, ptr) }
            }
        } else {
            EventRouterView.forwardCmdKeyCallback = nil
        }
    }
}

@_cdecl("ghostty_bridge_set_modifier_forward_callback")
public func ghosttyBridgeSetModifierForwardCallback(_ cb: ModifierForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            EventRouterView.forwardModifierStateCallback = { wid, mods in
                cb(wid, mods)
            }
        } else {
            EventRouterView.forwardModifierStateCallback = nil
        }
    }
}

@_cdecl("ghostty_bridge_set_app_shortcut_keys")
public func ghosttyBridgeSetAppShortcutKeys(
    _ keysPtr: UnsafePointer<UnsafePointer<CChar>?>?,
    _ count: Int
) {
    MainActor.assumeIsolated {
        var keys: Set<String> = []
        if let keysPtr {
            for i in 0..<count {
                if let ptr = keysPtr[i] {
                    keys.insert(String(cString: ptr))
                }
            }
        }
        EventRouterView.setTerminalAppShortcutKeys(keys)
    }
}

@_cdecl("ghostty_bridge_set_mouse_forward_callback")
public func ghosttyBridgeSetMouseForwardCallback(_ cb: MouseForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            EventRouterView.forwardRightMouseCallback = { wid, panelId, x, y in
                panelId.withCString { ptr in cb(wid, ptr, x, y) }
            }
        } else {
            EventRouterView.forwardRightMouseCallback = nil
        }
    }
}

@_cdecl("ghostty_bridge_set_terminal_focus_request_callback")
public func ghosttyBridgeSetTerminalFocusRequestCallback(_ cb: TerminalFocusRequestCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            TerminalContainerView.forwardFocusRequestCallback = { wid, panelId in
                panelId.withCString { ptr in cb(wid, ptr) }
            }
        } else {
            TerminalContainerView.forwardFocusRequestCallback = nil
        }
    }
}

@_cdecl("ghostty_bridge_set_open_url_forward_callback")
public func ghosttyBridgeSetOpenUrlForwardCallback(_ cb: OpenUrlForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            TerminalEventDelegate.forwardOpenUrlCallback = { wid, panelId, url, kind in
                panelId.withCString { pidPtr in
                    url.withCString { urlPtr in
                        kind.withCString { kindPtr in
                            cb(wid, pidPtr, urlPtr, kindPtr)
                        }
                    }
                }
            }
        } else {
            TerminalEventDelegate.forwardOpenUrlCallback = nil
        }
    }
}

@_cdecl("ghostty_bridge_set_pwd_forward_callback")
public func ghosttyBridgeSetPwdForwardCallback(_ cb: PwdForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            TerminalEventDelegate.forwardPwdCallback = { wid, panelId, cwd in
                panelId.withCString { pidPtr in
                    cwd.withCString { cwdPtr in
                        cb(wid, pidPtr, cwdPtr)
                    }
                }
            }
        } else {
            TerminalEventDelegate.forwardPwdCallback = nil
        }
    }
}

@_cdecl("ghostty_bridge_set_search_forward_callback")
public func ghosttyBridgeSetSearchForwardCallback(_ cb: SearchForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            TerminalEventDelegate.forwardSearchCallback = { wid, panelId, total, selected in
                panelId.withCString { pidPtr in
                    cb(wid, pidPtr, total, selected)
                }
            }
        } else {
            TerminalEventDelegate.forwardSearchCallback = nil
        }
    }
}

@_cdecl("ghostty_bridge_set_title_forward_callback")
public func ghosttyBridgeSetTitleForwardCallback(_ cb: TitleForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            TerminalEventDelegate.forwardTitleCallback = { wid, panelId, lifecycleId, title in
                panelId.withCString { pidPtr in
                    lifecycleId.withCString { lifecyclePtr in
                        title.withCString { titlePtr in
                            cb(wid, pidPtr, lifecyclePtr, titlePtr)
                        }
                    }
                }
            }
        } else {
            TerminalEventDelegate.forwardTitleCallback = nil
        }
    }
}

@_cdecl("ghostty_bridge_set_command_finished_forward_callback")
public func ghosttyBridgeSetCommandFinishedForwardCallback(_ cb: CommandFinishedForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            TerminalEventDelegate.forwardCommandFinishedCallback = { wid, panelId, lifecycleId, exitCode, durationNanos in
                panelId.withCString { pidPtr in
                    lifecycleId.withCString { lifecyclePtr in
                        cb(wid, pidPtr, lifecyclePtr, exitCode, durationNanos)
                    }
                }
            }
        } else {
            TerminalEventDelegate.forwardCommandFinishedCallback = nil
        }
    }
}

@_cdecl("ghostty_bridge_set_command_started_forward_callback")
public func ghosttyBridgeSetCommandStartedForwardCallback(_ cb: CommandStartedForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            TerminalEventDelegate.forwardCommandStartedCallback = { wid, panelId, lifecycleId, commandLine in
                panelId.withCString { pidPtr in
                    lifecycleId.withCString { lifecyclePtr in
                        commandLine.withCString { cmdPtr in
                            cb(wid, pidPtr, lifecyclePtr, cmdPtr)
                        }
                    }
                }
            }
        } else {
            TerminalEventDelegate.forwardCommandStartedCallback = nil
        }
    }
}

@_cdecl("ghostty_bridge_set_process_closed_forward_callback")
public func ghosttyBridgeSetProcessClosedForwardCallback(_ cb: ProcessClosedForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            TerminalEventDelegate.forwardProcessClosedCallback = { wid, panelId, lifecycleId, processAlive in
                panelId.withCString { pidPtr in
                    lifecycleId.withCString { lifecyclePtr in
                        cb(wid, pidPtr, lifecyclePtr, processAlive)
                    }
                }
            }
        } else {
            TerminalEventDelegate.forwardProcessClosedCallback = nil
        }
    }
}

@_cdecl("ghostty_bridge_apply_window_state")
public func ghosttyBridgeApplyWindowState(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ jsonPtr: UnsafePointer<CChar>
) -> Int32 {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        return GhosttyBridgeImpl.shared.applyWindowState(
            parent: window,
            json: String(cString: jsonPtr)
        ).rawValue
    }
}

/// palette 必须长度 16, 且每槽非空 (Pier renderer derive 阶段保证). cursor /
/// selectionBackground / selectionForeground 可空. 调用同步处理: addon.mm 的
/// std::string 在本调用栈内保持, swift 这里立即 String(cString:) 拷贝, 拷贝完
/// 所有指针即可失效.
@_cdecl("ghostty_bridge_apply_theme")
public func ghosttyBridgeApplyTheme(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ backgroundPtr: UnsafePointer<CChar>,
    _ foregroundPtr: UnsafePointer<CChar>,
    _ cursorPtr: UnsafePointer<CChar>?,
    _ selectionBackgroundPtr: UnsafePointer<CChar>?,
    _ selectionForegroundPtr: UnsafePointer<CChar>?,
    _ palettePtr: UnsafePointer<UnsafePointer<CChar>?>
) {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        var palette: [Int: String] = [:]
        for i in 0..<16 {
            if let p = palettePtr.advanced(by: i).pointee {
                palette[i] = stripHash(String(cString: p))
            }
        }
        GhosttyBridgeImpl.shared.applyTheme(
            window: window,
            background: stripHash(String(cString: backgroundPtr)),
            foreground: stripHash(String(cString: foregroundPtr)),
            cursor: cursorPtr.map { stripHash(String(cString: $0)) },
            selectionBackground: selectionBackgroundPtr.map {
                stripHash(String(cString: $0))
            },
            selectionForeground: selectionForegroundPtr.map {
                stripHash(String(cString: $0))
            },
            palette: palette
        )
    }
}
