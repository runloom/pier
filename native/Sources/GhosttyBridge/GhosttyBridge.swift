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

    /// 路由 keyDown:
    /// - 非 owner window 的 event: 放行 (其他 window 自己的 router 会处理).
    /// - 不含 Cmd: 放行给 firstResponder (terminal 正常接 Ctrl/Shift/纯 key).
    /// - Cmd+key: 通过 callback emit (windowId, chord) 给 main → IPC 转 renderer
    ///   调 action; 消费事件 (return nil) 让 terminal 不再收到这个 keystroke.
    ///
    /// 不再 forward 到 WKWebView (旧实现 wk.keyDown 在 Electron 42 不可靠 —
    /// ViewsCompositorSuperview 才是真正渲染 web 的层, WKWebView 只是事件壳).
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

        // macOS menu reserved keys (Cmd+Q/Cmd+H/Cmd+M/Cmd+Comma 等 role-bound items)
        // 必须先让 NSApp.mainMenu 处理. performKeyEquivalent 命中 menu item 后会调
        // 该 item 的 action 并返回 true; 没命中返回 false. 不让 menu 优先会让 Cmd+Q
        // 永远 swallow 在 web forward 链 (web 没注册 → 静默 drop, 用户感受"Cmd+Q 失效").
        if NSApp.mainMenu?.performKeyEquivalent(with: event) == true {
            return nil
        }

        guard let chars = event.charactersIgnoringModifiers, !chars.isEmpty else { return event }
        EventRouterView.forwardCmdKeyCallback?(browserWindowId, mods.rawValue, chars)
        return nil
    }

    /// 路由 rightMouseDown:
    /// - 非 owner window: 放行
    /// - 不在任何 terminal target rect 内: 放行 (空白区 / web panel 让 React onContextMenu 处理)
    /// - 在 terminal rect 内: forward (windowId, panelId, x, y) 给 main, 消费事件
    private func routeRightMouseDown(_ event: NSEvent) -> NSEvent? {
        guard let window = ownerWindow, event.window === window else { return event }
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

// MARK: - Terminal record

private struct Terminal {
    let containerView: NSView
    let terminalView: TerminalView
    let parentWindow: NSWindow
}

// MARK: - Bridge implementation

@MainActor
final class GhosttyBridgeImpl {
    static let shared = GhosttyBridgeImpl()

    /// EventRouter 命中矩形向内收缩的像素数, 给 dockview sash (4px) 留出事件通道。
    private static let hitInset: CGFloat = 5

    private var terminals: [String: Terminal] = [:]
    private var eventRouters: [ObjectIdentifier: EventRouterView] = [:]  // per-window
    /// per-window TerminalController. window close 时通过 detachWindow 释放 — 避免
    /// 旧 controller 内 session/PTY 列表跨 window 累积 (singleton 不会随 window
    /// 销毁而清理).
    private var controllers: [ObjectIdentifier: TerminalController] = [:]
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

    private func controller(for window: NSWindow) -> TerminalController {
        let windowId = ObjectIdentifier(window)
        if let existing = controllers[windowId] { return existing }
        let c = TerminalController { builder in
            builder.withBackgroundOpacity(1.0)
        }
        controllers[windowId] = c
        return c
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

        // 初始化 per-window keyboard state (PanelKind 默认 .web — 安全, 不抢 firstResponder)
        windowStates[windowId] = WindowKeyboardState()

        return true
    }

    // MARK: - Overlay control (PIER: new API)

    /// Per-window overlay state — 修复 v1 全局污染 bug (window-A 打开命令面板会让 window-B
    /// overlayCount 也 +1). 调用方 (main IPC handler) 必须传明确的 NSWindow.
    func setOverlayActive(window: NSWindow, _ active: Bool) {
        let windowId = ObjectIdentifier(window)
        guard let router = eventRouters[windowId] else { return }
        router.overlayActive = active
        // 物理隐藏: 从视图层级中移除, 确保 NSDragging 目标发现能找到 WKWebView
        router.isHidden = active

        mutateState(window) { state in
            state.overlayCount += active ? 1 : -1
            if state.overlayCount < 0 { state.overlayCount = 0 }  // defensive
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

        if state.inTerminalMode {
            if let panelId = state.activeTerminalPanelId,
               let term = terminals[panelId] {
                window.makeFirstResponder(term.terminalView)
            }
            // 没找到 terminal NSView → 不动 firstResponder (保留 web container default)
        }
        // Web mode: no-op. main 端在 setActivePanelKind('web') / setOverlayActive(true)
        // 时调 webContents.focus() 让 Chromium 自己 dispatch.
    }

    /// 注册 keyboard forward callback: swift NSEvent monitor 捕获 Cmd+key 后, 通过
    /// 这个 callback 把 (modifier flags, characters) 转给 main process. main 接收
    /// 后再通过 IPC 通知 renderer 解析 chord 调对应 action.
    ///
    /// 整个链路: 用户按 Cmd+T → NSEvent monitor → EventRouterView.routeKeyDown
    /// → forwardCmdKeyCallback (本回调) → N-API ThreadSafeFunction → main JS →
    /// win.webContents.send("pier:keybinding:forward") → preload listener → renderer
    /// 用 chord 找 action 调用 handler.
    ///
    /// 这条路径完全绕开 NSView responder chain (Ghostty terminal focus 时它消费
    /// 所有 key 是 wk.keyDown forward 不可靠的根因).
    func setKeyboardForwardCallback(_ cb: @escaping (Int, UInt, String) -> Void) {
        EventRouterView.forwardCmdKeyCallback = cb
    }

    /// 注册右键事件 forward callback. 与 keyboard 同构: swift EventRouterView 拦到
    /// terminal 区域 rightMouseDown 后, 通过此 callback 把 (windowId, panelId, x, y)
    /// 转给 main, main IPC 通知 renderer 弹菜单.
    func setMouseForwardCallback(_ cb: @escaping (Int, String, Double, Double) -> Void) {
        EventRouterView.forwardRightMouseCallback = cb
    }

    // MARK: - Terminal lifecycle

    func createTerminal(parent: NSWindow, panelId: String, viewport: NSRect) -> Bool {
        guard let contentView = parent.contentView else { return false }

        // Idempotent: 同 panelId 已存在 (如 reload 残留) → 先 close 旧的再创建.
        // main 进程 reload 监听 best-effort, 这里是 defensive 兜底防止 NSView 泄漏.
        if terminals[panelId] != nil {
            close(panelId: panelId)
        }

        let frame = computeFrame(in: contentView, viewport: viewport)

        let terminalView = TerminalView(frame: NSRect(origin: .zero, size: frame.size))
        terminalView.autoresizingMask = [.width, .height]
        terminalView.configuration = TerminalSurfaceOptions(backend: .exec)
        terminalView.controller = controller(for: parent)

        // Container 只是 frame holder, 自身不绘制. terminalView 内的 IOSurfaceLayer
        // (opaque=true) 已经渲染 terminal 全部像素, 不需要 container 再画 background —
        // 旧代码 backgroundColor=black 多余, 会让 CoreAnimation 创建额外 backing
        // texture, 增加 GPU 合成成本且视觉无效 (被 terminalView 完全遮挡).
        let container = NSView(frame: frame)
        container.addSubview(terminalView)

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

        terminals[panelId] = Terminal(
            containerView: container,
            terminalView: terminalView,
            parentWindow: parent
        )

        // 更新 EventRouter targets (inset 留出 sash 事件通道)
        let windowId = ObjectIdentifier(parent)
        eventRouters[windowId]?.targets[panelId] = EventRouterView.Target(
            rect: frame.insetBy(dx: Self.hitInset, dy: Self.hitInset), view: terminalView
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
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        term.containerView.frame = frame
        CATransaction.commit()

        // 同步 EventRouter targets (inset 留出 sash 事件通道)
        let windowId = ObjectIdentifier(term.parentWindow)
        eventRouters[windowId]?.targets[panelId] = EventRouterView.Target(
            rect: frame.insetBy(dx: Self.hitInset, dy: Self.hitInset), view: term.terminalView
        )
    }

    func show(panelId: String) {
        guard let term = terminals[panelId] else { return }
        activePanelId = panelId

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if let contentView = term.parentWindow.contentView {
            // 确保终端在所有 web 渲染层之下 (见 createTerminal 注释)
            contentView.addSubview(term.containerView, positioned: .below, relativeTo: nil)
        }
        term.containerView.alphaValue = 1
        term.containerView.isHidden = false
        CATransaction.commit()
    }

    func hide(panelId: String) {
        guard let term = terminals[panelId] else { return }
        guard panelId != activePanelId else { return }
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
        // 释放该 window 的 TerminalController — 内部 session/PTY 列表跨 window 累积
        // 是潜在内存泄漏, swift ARC 让无引用 controller 自动 dealloc.
        controllers.removeValue(forKey: windowId)
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
    _ panelId: UnsafePointer<CChar>,
    _ x: Double, _ y: Double, _ w: Double, _ h: Double
) -> Bool {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        let viewport = NSRect(x: x, y: y, width: w, height: h)
        return GhosttyBridgeImpl.shared.createTerminal(
            parent: window, panelId: String(cString: panelId), viewport: viewport
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

@_cdecl("ghostty_bridge_detach_window")
public func ghosttyBridgeDetachWindow(_ nsWindowPtr: UnsafeMutableRawPointer) {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        GhosttyBridgeImpl.shared.detachWindow(parent: window)
    }
}

/// C 函数指针类型: 接收 browserWindowId (Int), modifier flags (raw UInt), characters
/// (C string UTF-8). addon.mm 包装成 ThreadSafeFunction 让 JS 端能安全接收.
public typealias KeyboardForwardCallback = @convention(c) (Int, UInt, UnsafePointer<CChar>) -> Void

@_cdecl("ghostty_bridge_set_keyboard_forward_callback")
public func ghosttyBridgeSetKeyboardForwardCallback(_ cb: KeyboardForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            GhosttyBridgeImpl.shared.setKeyboardForwardCallback { wid, mods, chars in
                chars.withCString { ptr in cb(wid, mods, ptr) }
            }
        } else {
            GhosttyBridgeImpl.shared.setKeyboardForwardCallback { _, _, _ in }
        }
    }
}

/// C 函数指针: (browserWindowId, panelId C string, x, y).
public typealias MouseForwardCallback = @convention(c) (Int, UnsafePointer<CChar>, Double, Double) -> Void

@_cdecl("ghostty_bridge_set_mouse_forward_callback")
public func ghosttyBridgeSetMouseForwardCallback(_ cb: MouseForwardCallback?) {
    MainActor.assumeIsolated {
        if let cb {
            GhosttyBridgeImpl.shared.setMouseForwardCallback { wid, panelId, x, y in
                panelId.withCString { ptr in cb(wid, ptr, x, y) }
            }
        } else {
            GhosttyBridgeImpl.shared.setMouseForwardCallback { _, _, _, _ in }
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
