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

/// 完全透明的 NSView，只 override hitTest 做事件路由。
/// 放在 contentView 最顶层，根据终端矩形分发事件到终端或 web 层。
final class EventRouterView: NSView {
    struct Target {
        let rect: NSRect
        let view: NSView
    }

    var targets: [String: Target] = [:]
    var overlayActive = false

    override var isOpaque: Bool { false }
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
    private var activePanelId: String?

    private lazy var sharedController: TerminalController = TerminalController { builder in
        builder.withBackgroundOpacity(1.0)
    }

    // MARK: - Window setup (PIER: new API)

    /// 一次性初始化: 创建 EventRouterView + WKWebView 透明化
    func setupWindow(parent: NSWindow) -> Bool {
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

        // WKWebView 透明化: 遍历 WebContentsViewCocoa 子视图找到真正的 WKWebView
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
                realWK.setValue(NSColor.clear, forKey: "underPageBackgroundColor")
            }
        }

        // 创建 EventRouterView (最顶层)
        let router = EventRouterView(frame: contentView.bounds)
        router.autoresizingMask = [.width, .height]
        contentView.addSubview(router, positioned: .above, relativeTo: nil)
        eventRouters[windowId] = router

        return true
    }

    // MARK: - Overlay control (PIER: new API)

    func setOverlayActive(_ active: Bool) {
        for (_, router) in eventRouters {
            router.overlayActive = active
        }
    }

    // MARK: - Terminal lifecycle

    func createTerminal(parent: NSWindow, panelId: String, viewport: NSRect) -> Bool {
        guard let contentView = parent.contentView else { return false }

        let frame = computeFrame(in: contentView, viewport: viewport)

        let terminalView = TerminalView(frame: NSRect(origin: .zero, size: frame.size))
        terminalView.autoresizingMask = [.width, .height]
        terminalView.configuration = TerminalSurfaceOptions(backend: .exec)
        terminalView.controller = sharedController

        let container = NSView(frame: frame)
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.black.cgColor
        container.addSubview(terminalView)

        // PIER: 放在 WKWebView 之下
        // 查找 WKWebView 作为参照
        var wkWebView: NSView?
        for subview in contentView.subviews {
            if String(describing: type(of: subview)).contains("WKWebView")
                || String(describing: type(of: subview)).contains("WebContentsView") {
                wkWebView = subview
                break
            }
        }

        if let wk = wkWebView {
            contentView.addSubview(container, positioned: .below, relativeTo: wk)
        } else {
            contentView.addSubview(container, positioned: .below, relativeTo: nil)
        }

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
            // 找到 WKWebView，确保终端在其下方
            var wkWebView: NSView?
            for subview in contentView.subviews {
                if String(describing: type(of: subview)).contains("WKWebView")
                    || String(describing: type(of: subview)).contains("WebContentsView") {
                    wkWebView = subview
                    break
                }
            }
            if let wk = wkWebView {
                contentView.addSubview(term.containerView, positioned: .below, relativeTo: wk)
            }
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
        term.containerView.removeFromSuperview()
        terminals.removeValue(forKey: panelId)
        if activePanelId == panelId { activePanelId = nil }

        let windowId = ObjectIdentifier(term.parentWindow)
        eventRouters[windowId]?.targets.removeValue(forKey: panelId)
    }

    func focus(panelId: String) {
        guard let term = terminals[panelId] else { return }
        activePanelId = panelId
        term.terminalView.window?.makeFirstResponder(term.terminalView)
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
public func ghosttyBridgeSetupWindow(_ nsWindowPtr: UnsafeMutableRawPointer) -> Bool {
    MainActor.assumeIsolated {
        let window = Unmanaged<NSWindow>.fromOpaque(nsWindowPtr).takeUnretainedValue()
        return GhosttyBridgeImpl.shared.setupWindow(parent: window)
    }
}

@_cdecl("ghostty_bridge_set_overlay_active")
public func ghosttyBridgeSetOverlayActive(_ active: Bool) {
    MainActor.assumeIsolated {
        GhosttyBridgeImpl.shared.setOverlayActive(active)
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
