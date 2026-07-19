import AppKit
import GhosttyTerminal

@MainActor
protocol TerminalScrollbarStateSink: AnyObject {
    func terminalScrollbarStateDidChange(_ state: TerminalScrollbarState)
}

private enum TerminalMouseButton {
    case left
    case right
    case other
}

@MainActor
final class TerminalContainerView: NSView, TerminalScrollbarStateSink {
    static var forwardFocusRequestCallback: ((Int, String) -> Void)?

    let terminalView: TerminalView
    private let terminalScrollView: AppTerminalScrollView
    private(set) var browserWindowId: Int
    private let panelId: String
    private var capturedTerminalMouseButton: TerminalMouseButton?

    var backgroundColor: NSColor = .black {
        didSet {
            layer?.backgroundColor = backgroundColor.cgColor
        }
    }

    init(frame frameRect: NSRect, terminalView: TerminalView, panelId: String, browserWindowId: Int) {
        self.terminalView = terminalView
        terminalScrollView = AppTerminalScrollView(terminalView: terminalView)
        self.panelId = panelId
        self.browserWindowId = browserWindowId
        super.init(frame: frameRect)

        wantsLayer = true
        layer?.backgroundColor = backgroundColor.cgColor

        terminalScrollView.onScrollerInteraction = { [weak self] in
            self?.activateFocusIntent()
        }
        addSubview(terminalScrollView)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var isOpaque: Bool { false }

    override func acceptsFirstMouse(for _: NSEvent?) -> Bool {
        true
    }

    override func layout() {
        super.layout()
        synchronizeChildFrames()
    }

    func applyHostFrame(_ hostFrame: NSRect) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        frame = hostFrame
        synchronizeChildFrames()
        terminalView.flushHostResizeFrame()
        CATransaction.commit()
    }

    func updateBrowserWindowId(_ browserWindowId: Int) {
        self.browserWindowId = browserWindowId
    }

    private func synchronizeChildFrames() {
        terminalScrollView.frame = bounds
        terminalScrollView.synchronizeLayout()
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard !isHidden, alphaValue > 0 else { return nil }
        let local = if let superview {
            convert(point, from: superview)
        } else {
            point
        }
        guard bounds.contains(local) else { return nil }

        let scrollPoint = terminalScrollView.convert(local, from: self)
        if let target = terminalScrollView.hitTest(scrollPoint),
           terminalScrollView.isScrollerHitTarget(target)
        {
            return target
        }

        return self
    }

    func terminalScrollbarStateDidChange(_ state: TerminalScrollbarState) {
        terminalScrollView.applyScrollbarState(state)
    }

    private func activateFocusIntent() {
        Self.forwardFocusRequestCallback?(browserWindowId, panelId)
    }

    override func scrollWheel(with event: NSEvent) {
        terminalScrollView.scrollWheel(with: event)
    }

    override func mouseDown(with event: NSEvent) {
        guard shouldForwardTerminalEvent(event) else {
            super.mouseDown(with: event)
            return
        }
        capturedTerminalMouseButton = .left
        activateFocusIntent()
        terminalView.mouseDown(with: event)
    }

    override func mouseUp(with event: NSEvent) {
        if capturedTerminalMouseButton == .left {
            defer { capturedTerminalMouseButton = nil }
            terminalView.mouseUp(with: event)
            return
        }
        guard shouldForwardTerminalEvent(event) else {
            super.mouseUp(with: event)
            return
        }
        terminalView.mouseUp(with: event)
    }

    override func mouseDragged(with event: NSEvent) {
        if capturedTerminalMouseButton == .left {
            terminalView.mouseDragged(with: event)
            return
        }
        guard shouldForwardTerminalEvent(event) else {
            super.mouseDragged(with: event)
            return
        }
        terminalView.mouseDragged(with: event)
    }

    override func rightMouseDown(with event: NSEvent) {
        guard shouldForwardTerminalEvent(event) else {
            super.rightMouseDown(with: event)
            return
        }
        capturedTerminalMouseButton = .right
        terminalView.rightMouseDown(with: event)
    }

    override func rightMouseUp(with event: NSEvent) {
        if capturedTerminalMouseButton == .right {
            defer { capturedTerminalMouseButton = nil }
            terminalView.rightMouseUp(with: event)
            return
        }
        guard shouldForwardTerminalEvent(event) else {
            super.rightMouseUp(with: event)
            return
        }
        terminalView.rightMouseUp(with: event)
    }

    override func rightMouseDragged(with event: NSEvent) {
        if capturedTerminalMouseButton == .right {
            terminalView.rightMouseDragged(with: event)
            return
        }
        guard shouldForwardTerminalEvent(event) else {
            super.rightMouseDragged(with: event)
            return
        }
        terminalView.rightMouseDragged(with: event)
    }

    override func otherMouseDown(with event: NSEvent) {
        guard shouldForwardTerminalEvent(event) else {
            super.otherMouseDown(with: event)
            return
        }
        capturedTerminalMouseButton = .other
        activateFocusIntent()
        terminalView.otherMouseDown(with: event)
    }

    override func otherMouseUp(with event: NSEvent) {
        if capturedTerminalMouseButton == .other {
            defer { capturedTerminalMouseButton = nil }
            terminalView.otherMouseUp(with: event)
            return
        }
        guard shouldForwardTerminalEvent(event) else {
            super.otherMouseUp(with: event)
            return
        }
        terminalView.otherMouseUp(with: event)
    }

    override func otherMouseDragged(with event: NSEvent) {
        if capturedTerminalMouseButton == .other {
            terminalView.otherMouseDragged(with: event)
            return
        }
        guard shouldForwardTerminalEvent(event) else {
            super.otherMouseDragged(with: event)
            return
        }
        terminalView.otherMouseDragged(with: event)
    }

    override func mouseMoved(with event: NSEvent) {
        guard shouldForwardTerminalEvent(event) else {
            terminalScrollView.mouseMoved(with: event)
            return
        }
        terminalView.mouseMoved(with: event)
    }

    private func shouldForwardTerminalEvent(_ event: NSEvent) -> Bool {
        let local = convert(event.locationInWindow, from: nil)
        guard bounds.contains(local) else { return false }

        let scrollPoint = terminalScrollView.convert(local, from: self)
        guard let target = terminalScrollView.hitTest(scrollPoint) else {
            return true
        }
        return !terminalScrollView.isScrollerHitTarget(target)
    }
}
