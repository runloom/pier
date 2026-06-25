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
//   - 新增 setupWindow / setOverlayActive API
//   - WKWebView 设为透明

import AppKit
import GhosttyTerminal
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
/// Mouse: 透明 NSView, override hitTest 按位置路由 (terminal 区域 → terminal, 否则
/// fall through 到 web).
///
/// Keyboard: 用 NSEvent local monitor 拦截. terminal 一旦 focus 就消费所有 key
/// (Ghostty TerminalView 是 firstResponder), 导致 web 层 useKeyboardShortcuts 收
/// 不到全局快捷键. 含 Cmd 修饰的组合 → 通过 forwardCallback 把 chord 转给 main
/// process, main 通过 IPC 调 renderer 直接 resolve action — 完全绕开 NSView
/// responder chain (因为 wk.keyDown forward 在 Electron 42 ViewsCompositorSuperview
/// 架构下不可靠 — 真正渲染 web 的是 ViewsCompositorSuperview 不是 WKWebView).
/// 非 Cmd 组合放行给 firstResponder (terminal 正常处理 Ctrl+C / 普通输入 / IME 等).
final class EventRouterView: NSView {
    struct Target {
        let rect: NSRect
        let view: NSView
    }

    var targets: [String: Target] = [:]
    var overlayActive = false

    private weak var ownerWindow: NSWindow?
    private var keyMonitor: Any?
    private var mouseMonitor: Any?

    /// 全局 callback: swift monitor 捕获 Cmd+key 后调用, 把 chord 转给 main process.
    /// 签名 (browserWindowId, modifierFlags, chars) — 多窗口下 main 用 windowId
    /// 路由 (`BrowserWindow.fromId`), 而不是 `getFocusedWindow()` (背景窗口按 key
    /// 时 focused 已切走会路由错).
    static var forwardCmdKeyCallback: ((Int, UInt, String) -> Void)?

    /// Right-mouse 转发: 用户在 terminal 区域右键 → main → renderer → 弹原生菜单.
    /// 签名 (browserWindowId, panelId, contentX, contentY) — 坐标系是 BrowserWindow
    /// 的 contentView (top-left origin, flipped), 即 Electron renderer 内坐标, 也是
    /// Electron Menu.popup({x,y}) 期待的格式.
    static var forwardRightMouseCallback: ((Int, String, Double, Double) -> Void)?

    /// Electron BrowserWindow.id — main 进程调 setupWindow 时传入. forward callback
    /// 用它告诉 main 这个 key event 来自哪个 window.
    private var browserWindowId: Int = -1

    private static let terminalAppShortcutKeys: Set<String> = [
        "Ctrl+Shift+ArrowDown",
        "Ctrl+Shift+ArrowLeft",
        "Ctrl+Shift+ArrowRight",
        "Ctrl+Shift+ArrowUp",
        "Mod+Backquote",
        "Mod+Comma",
        "Mod+KeyD",
        "Mod+KeyN",
        "Mod+KeyT",
        "Mod+KeyW",
        "Mod+Shift+KeyD",
        "Mod+Shift+KeyP",
    ]

    override var isOpaque: Bool { false }
    override var isFlipped: Bool { true }  // 对齐 Electron contentView 的 top-left 坐标系
    override func draw(_ dirtyRect: NSRect) {}

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard !overlayActive else { return nil }
        guard let sv = superview else { return nil }
        let local = convert(point, from: sv)
        for (_, target) in targets {
            if target.rect.contains(local) {
                let p = target.view.superview?.convert(point, from: sv) ?? point
                return target.view.hitTest(p)
            }
        }
        return nil
    }

    /// 在 setupWindow 后调用一次, 绑定 window 并安装 keyboard + mouse 监听.
    /// browserWindowId 来自 Electron BrowserWindow.id, forward 时回传给 main 路由.
    func attachInputRouting(window: NSWindow, browserWindowId: Int) {
        ownerWindow = window
        self.browserWindowId = browserWindowId
        if keyMonitor == nil {
            keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) {
                [weak self] event in
                guard let self else { return event }
                return self.routeKeyDown(event)
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

    /// 路由 keyDown: terminal mode 下只截获 Pier 明确声明的 app 快捷键, 其他
    /// Cmd / Ctrl+Shift 组合交给 Ghostty, 避免吞掉终端编辑和 TUI 快捷键.
    private func routeKeyDown(_ event: NSEvent) -> NSEvent? {
        guard let window = ownerWindow, event.window === window else { return event }

        // Web mode (overlay active OR active panel is web): 全 pass through.
        // firstResponder 已 swap 到 WKWebView, web DOM 自然接所有 key (含 ↑/↓/Enter/Cmd+A/Cmd+T 等).
        // 不在此处拦截 Cmd+key — let web's useKeyboardShortcuts 路径 1 (DOM keydown capture)
        // 用 scopeStore 按 [overlay阻断] > [panel] > [global] 优先级 resolve.
        let state = GhosttyBridgeImpl.shared.stateFor(window: window)
        guard state.inTerminalMode else { return event }

        // Terminal mode: 拦截 Cmd+key 或 Ctrl+Shift+key forward 给 web (路径 2 IPC),
        // 其他 pass through 给 Ghostty. Ctrl+Shift+ 是为 web 层 focus 方向导航等 binding
        // 留的口子 — 单 Ctrl 留给 Ghostty 不动 (shell Ctrl+C 等).
        let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let isCmd = mods.contains(.command)
        let isCtrlShift = mods.contains(.control) && mods.contains(.shift)

        guard isCmd || isCtrlShift else {
            return passThroughToTerminal(window: window, event: event)
        }

        // macOS menu reserved keys (Cmd+Q/Cmd+H/Cmd+M/Cmd+Comma 等 role-bound items)
        // 必须先让 NSApp.mainMenu 处理. performKeyEquivalent 命中 menu item 后会调
        // 该 item 的 action 并返回 true; 没命中返回 false. 不让 menu 优先会让 Cmd+Q
        // 永远 swallow 在 web forward 链 (web 没注册 → 静默 drop, 用户感受"Cmd+Q 失效").
        // 仅 Cmd 路径走 menu — menu items 全部都是 Cmd+... 修饰, Ctrl+Shift 不参与.
        if isCmd, NSApp.mainMenu?.performKeyEquivalent(with: event) == true {
            return nil
        }

        guard let chars = event.charactersIgnoringModifiers, !chars.isEmpty else {
            return passThroughToTerminal(window: window, event: event)
        }
        guard let shortcutKey = Self.terminalAppShortcutKey(modifierFlags: mods, chars: chars),
              Self.terminalAppShortcutKeys.contains(shortcutKey) else {
            return passThroughToTerminal(window: window, event: event)
        }

        EventRouterView.forwardCmdKeyCallback?(browserWindowId, mods.rawValue, chars)
        return nil
    }

    /// 路由 rightMouseDown:
    /// - 非 owner window: 放行
    /// - overlay 打开期间: 放行 (router.isHidden 仅 block hitTest, 不 block NSEvent local
    ///   monitor; 若不显式 guard, 命令面板期间右键 terminal 会弹菜单在 overlay 下方)
    /// - 不在任何 terminal target rect 内: 放行 (空白区 / web panel 让 React onContextMenu 处理)
    /// - 在 terminal rect 内: forward (windowId, panelId, x, y) 给 main, 消费事件
    private func routeRightMouseDown(_ event: NSEvent) -> NSEvent? {
        guard let window = ownerWindow, event.window === window else { return event }
        let state = GhosttyBridgeImpl.shared.stateFor(window: window)
        guard !state.overlayActive else { return event }
        // 把 window 坐标转 EventRouterView 局部坐标 (与 hitTest 同套坐标变换);
        // EventRouterView.isFlipped=true 让 local 坐标系是 top-left origin, 跟 Electron
        // BrowserWindow contentView 一致, 可直接给 main 做 Menu.popup({x,y}).
        let local = self.convert(event.locationInWindow, from: nil)
        for (panelId, target) in targets {
            if target.rect.contains(local) {
                EventRouterView.forwardRightMouseCallback?(
                    browserWindowId, panelId, Double(local.x), Double(local.y)
                )
                return nil  // 消费, 不让 terminal NSView 收到右键
            }
        }
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
    TerminalSurfaceTitleDelegate,
    TerminalSurfaceScrollbarDelegate
{
    let panelId: String
    let browserWindowId: Int
    weak var scrollbarSink: TerminalScrollbarStateSink?

    /// 全局 callback: 收到 OSC 7 path 时调用, 把 (browserWindowId, panelId, path)
    /// 转给 main process.
    static var forwardPwdCallback: ((Int, String, String) -> Void)?

    /// 全局 callback: 收到 OSC 0/2 title 时调用, 把 (browserWindowId, panelId, title)
    /// 转给 main process. TUI 应用 (claude / vim / aider) 主动通过 OSC 0/2 写自定义
    /// title — descriptor.long 的最高优先级来源.
    static var forwardTitleCallback: ((Int, String, String) -> Void)?

    init(panelId: String, browserWindowId: Int) {
        self.panelId = panelId
        self.browserWindowId = browserWindowId
    }

    func terminalDidChangeWorkingDirectory(_ path: String) {
        TerminalEventDelegate.forwardPwdCallback?(browserWindowId, panelId, path)
    }

    func terminalDidChangeTitle(_ title: String) {
        TerminalEventDelegate.forwardTitleCallback?(browserWindowId, panelId, title)
    }

    func terminalDidUpdateScrollbar(_ state: TerminalScrollbarState) {
        scrollbarSink?.terminalScrollbarStateDidChange(state)
    }
}

// MARK: - Terminal record

private struct Terminal {
    let containerView: TerminalContainerView
    let terminalView: TerminalView
    let parentWindow: NSWindow
    /// EventDelegate adapter (strong-hold — terminalView.delegate 是 weak).
    /// 同时实现 PwdDelegate + TitleDelegate. 随 Terminal 一起释放, terminalView
    /// weak ref 自动 nil, 不留 dangling.
    let eventDelegate: TerminalEventDelegate
}

private struct TerminalRuntimePreferences {
    var fontFamily: String = ""
    var fontSize: Float = 0
    var cursorStyle: TerminalCursorStyle = .block
    var cursorBlink: Bool = true
    var scrollbackLimitBytes: UInt64 = 64_000_000
    var pasteProtection: Bool = true
}

struct TerminalLiveResizePredictor {
    private static let edgeTolerance: CGFloat = 1
    private static let edgeBleed: CGFloat = 2

    static func predict(
        lastFrame: NSRect,
        oldContentSize: NSSize,
        newContentSize: NSSize
    ) -> NSRect {
        let deltaWidth = newContentSize.width - oldContentSize.width
        let deltaHeight = newContentSize.height - oldContentSize.height
        let touchesRight = abs(lastFrame.maxX - oldContentSize.width) <= edgeTolerance
        let touchesBottom = lastFrame.minY <= edgeTolerance
        let touchesTop = abs(lastFrame.maxY - oldContentSize.height) <= edgeTolerance

        var next = lastFrame
        if touchesRight {
            next.size.width = max(lastFrame.width + deltaWidth + edgeBleed, 0)
        }
        if touchesBottom {
            next.origin.y = -edgeBleed
            next.size.height = max(lastFrame.height + deltaHeight + edgeBleed, 0)
        } else if touchesTop {
            next.origin.y = lastFrame.minY + deltaHeight
        }
        return next
    }
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

    mutating func predictProvisionalFrame(newContentSize: NSSize) -> NSRect {
        let frame = TerminalLiveResizePredictor.predict(
            lastFrame: authoritativeFrame,
            oldContentSize: authoritativeContentSize,
            newContentSize: newContentSize
        )
        presentedFrame = frame
        return frame
    }

    mutating func rememberAuthoritativeLayout(contentSize: NSSize, frame: NSRect) {
        authoritativeContentSize = contentSize
        authoritativeFrame = frame
        presentedFrame = frame
    }
}

// MARK: - Bridge implementation

@MainActor
final class GhosttyBridgeImpl {
    static let shared = GhosttyBridgeImpl()

    /// EventRouter 命中矩形向内收缩的像素数, 给 dockview sash (4px) 留出事件通道。
    /// 终端 scrollbar 必须绘制在这个 inset 内侧, 避免与 sash 抢同一条边界。
    private static let hitInset: CGFloat = 5

    private var terminals: [String: Terminal] = [:]
    private var eventRouters: [ObjectIdentifier: EventRouterView] = [:]  // per-window
    private var terminalBackgrounds: [ObjectIdentifier: NSColor] = [:]
    private var terminalForegrounds: [ObjectIdentifier: NSColor] = [:]
    private var terminalLayouts: [String: TerminalLayoutState] = [:]
    private var liveResizeContentSizes: [ObjectIdentifier: NSSize] = [:]
    private var liveResizeObservers: [ObjectIdentifier: NSObjectProtocol] = [:]
    /// per-window TerminalController. window close 时通过 detachWindow 释放 — 避免
    /// 旧 controller 内 session/PTY 列表跨 window 累积 (singleton 不会随 window
    /// 销毁而清理).
    private var controllers: [ObjectIdentifier: TerminalController] = [:]
    private var terminalRuntimePreferences: [ObjectIdentifier: TerminalRuntimePreferences] = [:]
    private var activePanelId: String?

    // MARK: - Keyboard state

    /// 当前 active 的 panel 类型 — terminal 或 web. 决定 firstResponder 该指向谁.
    enum PanelKind {
        case terminal, web
    }

    /// Per-window 键盘 routing 状态. 由 web 端 dockview onDidActivePanelChange +
    /// overlay 生命周期事件驱动; swift 不主动决策, 只读 state.
    struct WindowKeyboardState {
        var activePanelKind: PanelKind = .web   // boot 默认 web (terminal 未必存在)
        var activeTerminalPanelId: String?
        var overlayActive = false

        var inTerminalMode: Bool {
            activePanelKind == .terminal && !overlayActive
        }
    }

    // per-window state, 跟 eventRouters 一样用 ObjectIdentifier(window) 作 key
    private var windowStates: [ObjectIdentifier: WindowKeyboardState] = [:]

    /// NSWindow → browserWindowId 映射. setupWindow 时建立, detachWindow 时清理.
    /// createTerminal 用它给 TerminalEventDelegate 初始化 browserWindowId.
    private var windowToBrowserWindowId: [ObjectIdentifier: Int] = [:]

    func stateFor(window: NSWindow) -> WindowKeyboardState {
        return windowStates[ObjectIdentifier(window)] ?? WindowKeyboardState()
    }

    private func mutateState(_ window: NSWindow, _ mutate: (inout WindowKeyboardState) -> Void) {
        let windowId = ObjectIdentifier(window)
        var state = windowStates[windowId] ?? WindowKeyboardState()
        mutate(&state)
        windowStates[windowId] = state
    }

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
            if !preferences.fontFamily.isEmpty {
                builder.withFontFamily(preferences.fontFamily)
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

    private func mutateTerminalRuntimePreferences(
        window: NSWindow,
        _ mutate: (inout TerminalRuntimePreferences) -> Void
    ) {
        let windowId = ObjectIdentifier(window)
        var preferences = terminalRuntimePreferences[windowId] ?? TerminalRuntimePreferences()
        mutate(&preferences)
        terminalRuntimePreferences[windowId] = preferences
        controller(for: window).setTerminalConfiguration(
            Self.terminalConfiguration(from: preferences)
        )
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

    private func installLiveResizeObserver(parent: NSWindow, contentView: NSView) {
        let windowId = ObjectIdentifier(parent)
        guard liveResizeObservers[windowId] == nil else { return }
        contentView.postsBoundsChangedNotifications = true
        liveResizeContentSizes[windowId] = contentView.bounds.size
        let token = NotificationCenter.default.addObserver(
            forName: NSView.boundsDidChangeNotification,
            object: contentView,
            queue: .main
        ) { [weak parent] _ in
            guard let parent else { return }
            Task { @MainActor in
                GhosttyBridgeImpl.shared.handleContentViewLiveResize(parent: parent)
            }
        }
        liveResizeObservers[windowId] = token
    }

    private func handleContentViewLiveResize(parent: NSWindow) {
        guard let contentView = parent.contentView else { return }
        let windowId = ObjectIdentifier(parent)
        let oldSize = liveResizeContentSizes[windowId] ?? contentView.bounds.size
        let newSize = contentView.bounds.size
        guard oldSize != newSize else { return }
        liveResizeContentSizes[windowId] = newSize

        for (panelId, term) in terminals where term.parentWindow === parent {
            guard var state = terminalLayouts[panelId] else { continue }
            let frame = state.predictProvisionalFrame(newContentSize: newSize)
            terminalLayouts[panelId] = state
            term.containerView.applyHostFrame(frame)

            // EventRouter.targets[i].rect 必须用 viewport (top-left), 跟 EventRouterView
            // isFlipped=true 一致 — 见 terminalTargetRect 注释. live resize 路径上拿到
            // 的 frame 是 NSView frame (contentView bottom-left), 这里 Y-flip 回 viewport.
            let viewport = NSRect(
                x: frame.minX,
                y: contentView.bounds.height - frame.minY - frame.height,
                width: frame.width,
                height: frame.height
            )
            eventRouters[windowId]?.targets[panelId] = EventRouterView.Target(
                rect: Self.terminalTargetRect(viewport: viewport),
                view: term.containerView
            )
        }
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
        installLiveResizeObserver(parent: parent, contentView: contentView)

        // 初始化 per-window keyboard state (PanelKind 默认 .web — 安全, 不抢 firstResponder)
        windowStates[windowId] = WindowKeyboardState()

        // 记录 browserWindowId 映射 — PwdDelegate 反查 panel→window→browserId 路由 IPC.
        windowToBrowserWindowId[windowId] = browserWindowId

        return true
    }

    // MARK: - Overlay control (PIER: new API)

    /// Per-window overlay state — 修复 v1 全局污染 bug (window-A 打开命令面板会让 window-B
    /// overlay 状态被污染). 调用方 (main IPC handler) 必须传明确的 NSWindow.
    func setOverlayActive(window: NSWindow, _ active: Bool) {
        let windowId = ObjectIdentifier(window)
        guard let router = eventRouters[windowId] else { return }
        router.overlayActive = active
        // 物理隐藏: 从视图层级中移除, 确保 NSDragging 目标发现能找到 WKWebView
        router.isHidden = active

        mutateState(window) { state in
            state.overlayActive = active
        }
        applyFirstResponder(for: window)
    }

    /// 通知 swift 当前 active panel 是 terminal 还是 web. 由 web 端 dockview
    /// onDidActivePanelChange 触发. swift 不主动决策, 只更新 state — 后续 task
    /// 加 applyFirstResponder 调用让它真正 swap firstResponder.
    func setActivePanelKind(window: NSWindow, kind: PanelKind, panelId: String?) {
        mutateState(window) { state in
            state.activePanelKind = kind
            state.activeTerminalPanelId = kind == .terminal ? panelId : nil
        }
        applyFirstResponder(for: window)
    }

    /// 按 windowStates 当前 state 重算 + apply firstResponder.
    /// 不用 savedFirstResponder restore 模型 — active panel 可能在 overlay 期间被
    /// 切换, pop overlay 后恢复"之前"的 firstResponder 不一定对 (旧 panel 可能已 close).
    /// 按当前 state 重算更可靠.
    ///
    /// v2: web mode 不在 swift 这里 makeFirstResponder — 改由 main 调
    /// `BrowserWindow.webContents.focus()` (Electron 标准 API). 原因: Electron 42 用
    /// Chromium (不是 WebKit), view 树是 WebContentsViewCocoa > RenderWidgetHostViewCocoa,
    /// 没有真 WKWebView. v1 makeFirstResponder(找到的 WKWebView) 一直找错 type, fallback
    /// wrapper 也不接 key (acceptsFirstResponder=false). webContents.focus() 内部知道
    /// 正确的 NSView, 跨平台一致.
    func applyFirstResponder(for window: NSWindow) {
        let state = stateFor(window: window)
        let activeTerminalId: String? =
            state.inTerminalMode ? state.activeTerminalPanelId : nil

        // 主动给所有非 active terminal 调 resignFirstResponder, 让 ghostty surface
        // setFocus(false). 修复 drag/panel-swap 期间 AppKit 自动的 resignFirstResponder
        // 没传播到非当前 firstResponder 的 terminal NSView 的盲点 (firstResponder
        // 可能漂到 dockview 内部 web view, swap 回 terminal 时只触发新 view 的 become,
        // 没人触发旧 view 的 resign), 旧 terminal 卡在 focus=true → 多个 cursor 同时
        // 闪烁的"幽灵焦点". resignFirstResponder super 实现是 no-op, 安全可手动调.
        let windowId = ObjectIdentifier(window)
        for (panelId, term) in terminals
            where ObjectIdentifier(term.parentWindow) == windowId
                && panelId != activeTerminalId {
            _ = term.terminalView.resignFirstResponder()
        }

        if state.inTerminalMode {
            if let panelId = state.activeTerminalPanelId,
               let term = terminals[panelId] {
                if window.firstResponder !== term.terminalView {
                    window.makeFirstResponder(term.terminalView)
                }
                // 无条件 becomeFirstResponder. 双保险:
                // (1) firstResponder 已是 terminal 时强制刷新 ghostty surface focus —
                //     修原 detached DevTools 关闭 case;
                // (2) makeFirstResponder 失败 (oldResponder 拒绝 resign / dockview drag
                //     内部 view 抢占等) 时仍触发 ghostty surface setFocus(true), 让 user
                //     按键 dispatch 到 firstResponder (即使不是 terminal) 时, ghostty 至少
                //     不会 silently drop input.
                _ = term.terminalView.becomeFirstResponder()
            }
            // 没找到 terminal NSView → 不动 firstResponder (保留 web container default)
        }
        // Web mode: no-op. main 端在 setActivePanelKind('web') / setOverlayActive(true)
        // 时调 webContents.focus() 让 Chromium 自己 dispatch.
    }

    func prepareTerminalForOrdinaryKeyDown(
        window: NSWindow,
        event: NSEvent
    ) -> Bool {
        let state = stateFor(window: window)
        guard state.inTerminalMode,
              let panelId = state.activeTerminalPanelId,
              let term = terminals[panelId] else {
            return false
        }

        if window.firstResponder === term.terminalView {
            _ = term.terminalView.becomeFirstResponder()
            return false
        }

        guard window.makeFirstResponder(term.terminalView) else {
            return false
        }

        _ = term.terminalView.becomeFirstResponder()

        // Local event monitors run before AppKit dispatches the key event, but
        // changing firstResponder here is too late for the current event's
        // already-selected responder. Forward this one event manually so the
        // first character typed after closing detached DevTools is not lost.
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
        workingDirectory: String?
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
            if existing.parentWindow === parent {
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

                let windowId = ObjectIdentifier(parent)
                eventRouters[windowId]?.targets[panelId] = EventRouterView.Target(
                    rect: Self.terminalTargetRect(viewport: viewport),
                    view: existing.containerView
                )

                activePanelId = panelId
                applyFirstResponder(for: parent)
                return true
            }
            close(panelId: panelId)
        }

        let frame = computeFrame(in: contentView, viewport: viewport)

        let terminalView = TerminalView(frame: .zero)
        terminalView.configuration = TerminalSurfaceOptions(
            backend: .exec,
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
            browserWindowId: browserWindowId
        )
        terminalView.delegate = eventDelegate

        // Container 负责承载 terminalView 和右侧 overlay scrollbar. 终端内容仍由
        // Ghostty 的 TerminalView 渲染, scrollbar 只消费 Ghostty 暴露的 scrollback
        // 状态并把交互转回 TerminalView binding action.
        let container = TerminalContainerView(
            frame: frame,
            terminalView: terminalView,
            panelId: panelId,
            browserWindowId: browserWindowId
        )
        container.backgroundColor = terminalBackgrounds[parentWindowId] ?? .black
        container.scrollbarColor = terminalForegrounds[parentWindowId] ?? .white
        eventDelegate.scrollbarSink = container

        // PIER: 放在所有 web 渲染相关 NSView 之下.
        // Electron 42 macOS contentView 实际结构 (subviews 从底到顶):
        //   [0] ViewsCompositorSuperview — Chromium GPU compositor, 真正渲染 web 内容
        //   [1] WebContentsViewCocoa     — Electron 的空 wrapper
        //   [2] EventRouterView          — 我们的 hit-test 顶层
        // 旧逻辑: addSubview .below relativeTo WebContentsViewCocoa → container 进入
        //   subviews[1], 视觉上 cover 了 ViewsCompositorSuperview, terminal 遮挡 web.
        // 正确: .below relativeTo nil → 插入 subviews[0], 在 ViewsCompositorSuperview
        //   之下 (visually 最底), web 层可叠加在 terminal 之上.
        contentView.addSubview(container, positioned: .below, relativeTo: nil)
        container.applyHostFrame(frame)

        terminals[panelId] = Terminal(
            containerView: container,
            terminalView: terminalView,
            parentWindow: parent,
            eventDelegate: eventDelegate
        )
        rememberLayout(
            panelId: panelId,
            contentView: contentView,
            nativeFrame: frame
        )

        // 更新 EventRouter targets (inset 留出 sash 事件通道)
        let windowId = ObjectIdentifier(parent)
        eventRouters[windowId]?.targets[panelId] = EventRouterView.Target(
            rect: Self.terminalTargetRect(viewport: viewport), view: container
        )

        activePanelId = panelId

        // 反例 6 修复 v2: 无条件 applyFirstResponder. v1 加 `if activeTerminalPanelId
        // == panelId` guard 失败 — dockview 快速 fire 多个 active panel change 时, state
        // 已变成其他 panelId, guard 永不命中. applyFirstResponder 内部已有 safety check
        // (找不到 term 就不动 firstResponder), 无条件调用安全且可靠.
        //
        // 触发场景: layout 恢复 fromJSON 同步建多 panel + React mount 后异步 IPC create,
        // onDidActivePanelChange fire 给 panel A 时 terminals[A]=nil 先 swap fail; B fire
        // 后 state=B; A 的 createTerminal 完成补这一次, 不依赖 state 当前值.
        applyFirstResponder(for: parent)

        return true
    }

    func setFrame(panelId: String, viewport: NSRect) {
        guard let term = terminals[panelId],
              let contentView = term.parentWindow.contentView else { return }
        let frame = computeFrame(in: contentView, viewport: viewport)
        term.containerView.applyHostFrame(frame)
        rememberLayout(
            panelId: panelId,
            contentView: contentView,
            nativeFrame: frame
        )

        // 同步 EventRouter targets (inset 留出 sash 事件通道). target.rect 用
        // viewport (top-left) 不用 frame (bottom-left), 见 terminalTargetRect 注释.
        let windowId = ObjectIdentifier(term.parentWindow)
        eventRouters[windowId]?.targets[panelId] = EventRouterView.Target(
            rect: Self.terminalTargetRect(viewport: viewport),
            view: term.containerView
        )

        // Drag panel 完成时 dockview 大量 set-frame 给所有受影响 panel, 但不再 fire
        // focus IPC (active panel 没换). 期间 swift firstResponder 可能漂到 dockview
        // 内部 web view (drag overlay 等), drop 后没人重 apply firstResponder → user
        // 视觉看到 panel visible 但无法输入. 这里兜底:每次 active terminal 的 setFrame
        // 都重 apply firstResponder. 幂等, 多次调用无副作用 (applyFirstResponder 内部
        // 已 idempotent).
        let state = stateFor(window: term.parentWindow)
        if state.inTerminalMode, state.activeTerminalPanelId == panelId {
            applyFirstResponder(for: term.parentWindow)
        }
    }

    func show(panelId: String) {
        guard let term = terminals[panelId] else { return }
        activePanelId = panelId

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

    func hide(panelId: String) {
        guard let term = terminals[panelId] else { return }
        // 不 guard `panelId != activePanelId`. 该 guard 设计目的是防 drag drop 后没 show
        // 让 NSView 永远 offscreen, 但对同 group 切 tab 是错的:
        //   tab A→B: hide(A) 先到 main, 此时 swift.activePanelId 还是 A (focus(B) 还没到),
        //   guard 跳过 → A 不 hide → B 后续 addSubview .below nil 落 subviews[0], A 被
        //   push 到 [1] 仍 visible 且 z-order 在 B 之上 → user 看到 A 的内容, 切 tab 无效.
        // drag 场景实际靠 setFrame 紧跟 hide 把 NSView 移回新 visible 位置, 不依赖 guard.
        let f = term.containerView.frame
        if f.minX > -50000 {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            term.containerView.frame = NSRect(
                x: -99999, y: -99999, width: f.width, height: f.height
            )
            CATransaction.commit()
        }

        // 从 EventRouter targets 中移除 (offscreen 不需要路由)
        let windowId = ObjectIdentifier(term.parentWindow)
        eventRouters[windowId]?.targets.removeValue(forKey: panelId)
    }

    func close(panelId: String) {
        guard let term = terminals[panelId] else { return }
        let parent = term.parentWindow
        term.containerView.removeFromSuperview()
        terminals.removeValue(forKey: panelId)
        if activePanelId == panelId { activePanelId = nil }

        let windowId = ObjectIdentifier(parent)
        eventRouters[windowId]?.targets.removeValue(forKey: panelId)

        // 清 windowState stale activeTerminalPanelId — 防 use-after-free + 让
        // applyFirstResponder 不去 access 已 removeFromSuperview 的 terminalView.
        // close 后 dockview 会自动 fire onDidActivePanelChange to 下一个 panel,
        // web 端 listener 会再调 setActivePanelKind. 这里立即 swap 是 belt-and-
        // suspenders (web IPC 延迟时不留 stale state 窗口).
        mutateState(parent) { state in
            if state.activeTerminalPanelId == panelId {
                state.activeTerminalPanelId = nil
            }
        }
        applyFirstResponder(for: parent)
    }

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
        if let activeId = activePanelId, terminals[activeId] == nil {
            activePanelId = nil
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
        if let token = liveResizeObservers.removeValue(forKey: windowId) {
            NotificationCenter.default.removeObserver(token)
        }
        liveResizeContentSizes.removeValue(forKey: windowId)
        // 释放该 window 的 TerminalController — 内部 session/PTY 列表跨 window 累积
        // 是潜在内存泄漏, swift ARC 让无引用 controller 自动 dealloc.
        controllers.removeValue(forKey: windowId)
        terminalBackgrounds.removeValue(forKey: windowId)
        terminalForegrounds.removeValue(forKey: windowId)
        terminalRuntimePreferences.removeValue(forKey: windowId)
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
        if let foregroundColor = Self.terminalColor(from: foreground) {
            let windowId = ObjectIdentifier(window)
            terminalForegrounds[windowId] = foregroundColor
            for term in terminals.values where term.parentWindow === window {
                term.containerView.scrollbarColor = foregroundColor
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
        mutateTerminalRuntimePreferences(window: window) { preferences in
            preferences.fontFamily = fontFamily
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
    /// override isFlipped=true 走 top-left, 等价于 web viewport 坐标. **必须传 viewport
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

@_cdecl("ghostty_bridge_set_overlay_active")
public func ghosttyBridgeSetOverlayActive(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ active: Bool
) {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        GhosttyBridgeImpl.shared.setOverlayActive(window: window, active)
    }
}

@_cdecl("ghostty_bridge_create_terminal")
public func ghosttyBridgeCreateTerminal(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ panelIdPtr: UnsafePointer<CChar>,
    _ x: Double, _ y: Double, _ w: Double, _ h: Double,
    _ fontFamilyPtr: UnsafePointer<CChar>,
    _ fontSize: Float,
    _ workingDirectoryPtr: UnsafePointer<CChar>?
) -> Bool {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        let panelId = String(cString: panelIdPtr)
        let fontFamily = String(cString: fontFamilyPtr)
        let workingDirectory = workingDirectoryPtr.map { String(cString: $0) }
        let viewport = NSRect(x: x, y: y, width: w, height: h)
        return GhosttyBridgeImpl.shared.createTerminal(
            parent: window,
            panelId: panelId,
            viewport: viewport,
            fontFamily: fontFamily,
            fontSize: fontSize,
            workingDirectory: workingDirectory
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

@_cdecl("ghostty_bridge_set_frame")
public func ghosttyBridgeSetFrame(
    _ panelId: UnsafePointer<CChar>,
    _ x: Double, _ y: Double, _ w: Double, _ h: Double
) {
    MainActor.assumeIsolated {
        GhosttyBridgeImpl.shared.setFrame(
            panelId: String(cString: panelId),
            viewport: NSRect(x: x, y: y, width: w, height: h)
        )
    }
}

@_cdecl("ghostty_bridge_show")
public func ghosttyBridgeShow(_ panelId: UnsafePointer<CChar>) {
    MainActor.assumeIsolated {
        GhosttyBridgeImpl.shared.show(panelId: String(cString: panelId))
    }
}

@_cdecl("ghostty_bridge_hide")
public func ghosttyBridgeHide(_ panelId: UnsafePointer<CChar>) {
    MainActor.assumeIsolated {
        GhosttyBridgeImpl.shared.hide(panelId: String(cString: panelId))
    }
}

@_cdecl("ghostty_bridge_close")
public func ghosttyBridgeClose(_ panelId: UnsafePointer<CChar>) {
    MainActor.assumeIsolated {
        GhosttyBridgeImpl.shared.close(panelId: String(cString: panelId))
    }
}

@_cdecl("ghostty_bridge_focus")
public func ghosttyBridgeFocus(_ panelId: UnsafePointer<CChar>) {
    MainActor.assumeIsolated {
        GhosttyBridgeImpl.shared.focus(panelId: String(cString: panelId))
    }
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

// C 函数指针 typealias 集中放在一起 — addon.mm 通过 ThreadSafeFunction 包装让
// JS 端能安全接收. C string 在 @_cdecl 内 withCString 取临时指针调用 cb, cb 返回
// 后字符串生命周期结束 (addon.mm 端 trampoline 已 std::string 拷贝, 不会 dangling).
public typealias KeyboardForwardCallback = @convention(c) (Int, UInt, UnsafePointer<CChar>) -> Void
public typealias MouseForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, Double, Double) -> Void
public typealias TerminalFocusRequestCallback = @convention(c) (Int, UnsafePointer<CChar>) -> Void
public typealias PwdForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, UnsafePointer<CChar>) -> Void
public typealias TitleForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, UnsafePointer<CChar>) -> Void

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

@_cdecl("ghostty_bridge_set_title_forward_callback")
public func ghosttyBridgeSetTitleForwardCallback(_ cb: TitleForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            TerminalEventDelegate.forwardTitleCallback = { wid, panelId, title in
                panelId.withCString { pidPtr in
                    title.withCString { titlePtr in
                        cb(wid, pidPtr, titlePtr)
                    }
                }
            }
        } else {
            TerminalEventDelegate.forwardTitleCallback = nil
        }
    }
}

@_cdecl("ghostty_bridge_set_active_panel_kind")
public func ghosttyBridgeSetActivePanelKind(
    _ nsWindowPtr: UnsafeMutableRawPointer,
    _ kindRaw: Int,   // 0 = terminal, 1 = web
    _ panelIdPtr: UnsafePointer<CChar>?
) {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        let kind: GhosttyBridgeImpl.PanelKind = (kindRaw == 0) ? .terminal : .web
        let panelId: String? = panelIdPtr.flatMap { String(cString: $0) }
        GhosttyBridgeImpl.shared.setActivePanelKind(window: window, kind: kind, panelId: panelId)
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
