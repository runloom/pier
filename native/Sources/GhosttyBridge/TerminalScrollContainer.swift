import AppKit
import GhosttyTerminal

@MainActor
protocol TerminalScrollbarStateSink: AnyObject {
    func terminalScrollbarStateDidChange(_ state: TerminalScrollbarState)
}

struct TerminalContainerFrames: Equatable {
    let terminal: NSRect
    let scrollbar: NSRect
}

enum TerminalContainerHitTarget: Equatable {
    case terminal
    case scrollbar
}

private enum TerminalMouseButton {
    case left
    case right
    case other
}

enum TerminalContainerLayout {
    static let scrollbarHitWidth: CGFloat = 14
    static let scrollbarVisualWidth: CGFloat = 8
    static let scrollbarPaintedWidth: CGFloat = 6
    static let scrollbarRightInset: CGFloat = 2
    static let scrollbarVerticalInset: CGFloat = 4
    static let minThumbLength: CGFloat = 36

    static func frames(in bounds: NSRect) -> TerminalContainerFrames {
        let hitWidth = min(scrollbarHitWidth, bounds.width)
        return TerminalContainerFrames(
            terminal: bounds,
            scrollbar: NSRect(
                x: bounds.maxX - hitWidth,
                y: bounds.minY,
                width: hitWidth,
                height: bounds.height
            )
        )
    }

    static func hitTarget(
        at point: NSPoint,
        in bounds: NSRect,
        scrollbarActive: Bool
    ) -> TerminalContainerHitTarget? {
        guard bounds.contains(point) else { return nil }
        let frames = frames(in: bounds)
        if scrollbarActive, frames.scrollbar.contains(point) {
            return .scrollbar
        }
        return .terminal
    }
}

@MainActor
final class TerminalContainerView: NSView, TerminalScrollbarStateSink {
    static var forwardFocusRequestCallback: ((Int, String) -> Void)?

    let terminalView: TerminalView
    private let browserWindowId: Int
    private let panelId: String

    private let scrollbarView: TerminalScrollbarOverlayView
    private var capturedTerminalMouseButton: TerminalMouseButton?

    var backgroundColor: NSColor = .black {
        didSet {
            layer?.backgroundColor = backgroundColor.cgColor
        }
    }

    var scrollbarColor: NSColor = .white {
        didSet {
            scrollbarView.thumbColor = scrollbarColor
        }
    }

    init(frame frameRect: NSRect, terminalView: TerminalView, panelId: String, browserWindowId: Int) {
        self.terminalView = terminalView
        self.panelId = panelId
        self.browserWindowId = browserWindowId
        scrollbarView = TerminalScrollbarOverlayView(terminalView: terminalView)
        super.init(frame: frameRect)

        wantsLayer = true
        layer?.backgroundColor = backgroundColor.cgColor

        addSubview(terminalView)
        addSubview(scrollbarView)
        scrollbarView.thumbColor = scrollbarColor
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

    private func synchronizeChildFrames() {
        let frames = TerminalContainerLayout.frames(in: bounds)
        terminalView.frame = frames.terminal
        scrollbarView.frame = frames.scrollbar
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard !isHidden, alphaValue > 0 else { return nil }
        let local = if let superview {
            convert(point, from: superview)
        } else {
            point
        }

        switch TerminalContainerLayout.hitTarget(
            at: local,
            in: bounds,
            scrollbarActive: scrollbarView.isScrollable
        ) {
        case .scrollbar:
            return scrollbarView
        case .terminal:
            return self
        case nil:
            return nil
        }
    }

    func terminalScrollbarStateDidChange(_ state: TerminalScrollbarState) {
        scrollbarView.update(state)
    }

    override func scrollWheel(with event: NSEvent) {
        if hitTarget(for: event) == .terminal {
            terminalView.scrollWheel(with: event)
        } else {
            super.scrollWheel(with: event)
        }
    }

    override func mouseDown(with event: NSEvent) {
        guard hitTarget(for: event) == .terminal else {
            super.mouseDown(with: event)
            return
        }
        capturedTerminalMouseButton = .left
        Self.forwardFocusRequestCallback?(browserWindowId, panelId)
        terminalView.mouseDown(with: event)
    }

    override func mouseUp(with event: NSEvent) {
        if capturedTerminalMouseButton == .left {
            defer { capturedTerminalMouseButton = nil }
            terminalView.mouseUp(with: event)
            return
        }
        guard hitTarget(for: event) == .terminal else {
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
        guard hitTarget(for: event) == .terminal else {
            super.mouseDragged(with: event)
            return
        }
        terminalView.mouseDragged(with: event)
    }

    override func rightMouseDown(with event: NSEvent) {
        guard hitTarget(for: event) == .terminal else {
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
        guard hitTarget(for: event) == .terminal else {
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
        guard hitTarget(for: event) == .terminal else {
            super.rightMouseDragged(with: event)
            return
        }
        terminalView.rightMouseDragged(with: event)
    }

    override func otherMouseDown(with event: NSEvent) {
        guard hitTarget(for: event) == .terminal else {
            super.otherMouseDown(with: event)
            return
        }
        capturedTerminalMouseButton = .other
        terminalView.otherMouseDown(with: event)
    }

    override func otherMouseUp(with event: NSEvent) {
        if capturedTerminalMouseButton == .other {
            defer { capturedTerminalMouseButton = nil }
            terminalView.otherMouseUp(with: event)
            return
        }
        guard hitTarget(for: event) == .terminal else {
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
        guard hitTarget(for: event) == .terminal else {
            super.otherMouseDragged(with: event)
            return
        }
        terminalView.otherMouseDragged(with: event)
    }

    override func mouseMoved(with event: NSEvent) {
        guard hitTarget(for: event) == .terminal else {
            super.mouseMoved(with: event)
            return
        }
        terminalView.mouseMoved(with: event)
    }

    private func hitTarget(for event: NSEvent) -> TerminalContainerHitTarget? {
        let local = convert(event.locationInWindow, from: nil)
        return TerminalContainerLayout.hitTarget(
            at: local,
            in: bounds,
            scrollbarActive: scrollbarView.isScrollable
        )
    }
}

@MainActor
private final class TerminalScrollbarOverlayView: NSView {
    weak var terminalView: TerminalView?

    var thumbColor: NSColor = .white {
        didSet {
            needsDisplay = true
        }
    }

    private var state: TerminalScrollbarState?
    private var trackingArea: NSTrackingArea?
    private var isHovered = false {
        didSet {
            needsDisplay = true
        }
    }
    private var isDragging = false {
        didSet {
            needsDisplay = true
        }
    }
    private var didDrag = false
    private var dragThumbOffsetY: CGFloat = 0
    private var pendingPageAction: String?

    var isScrollable: Bool {
        guard let state else { return false }
        return state.total > state.length && state.length > 0
    }

    init(terminalView: TerminalView) {
        self.terminalView = terminalView
        super.init(frame: .zero)
        isHidden = true
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var isOpaque: Bool { false }

    override func acceptsFirstMouse(for _: NSEvent?) -> Bool {
        true
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard isScrollable, let thumbRect else { return }

        let alpha: CGFloat = if isDragging {
            0.58
        } else if isHovered {
            0.44
        } else {
            0.30
        }
        thumbColor.withAlphaComponent(alpha).setFill()
        NSBezierPath(
            roundedRect: thumbRect,
            xRadius: thumbRect.width / 2,
            yRadius: thumbRect.width / 2
        ).fill()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingArea {
            removeTrackingArea(trackingArea)
        }
        let area = NSTrackingArea(
            rect: .zero,
            options: [.mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        trackingArea = area
        addTrackingArea(area)
    }

    override func mouseEntered(with event: NSEvent) {
        super.mouseEntered(with: event)
        isHovered = true
    }

    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        if !isDragging {
            isHovered = false
        }
    }

    override func scrollWheel(with event: NSEvent) {
        terminalView?.scrollWheel(with: event)
    }

    override func mouseDown(with event: NSEvent) {
        terminalView?.window?.makeFirstResponder(terminalView)
        guard isScrollable, let thumbRect else { return }

        let local = convert(event.locationInWindow, from: nil)
        if thumbHitRect(for: thumbRect).contains(local) {
            isDragging = true
            didDrag = false
            pendingPageAction = nil
            dragThumbOffsetY = local.y - thumbRect.minY
            return
        }

        isDragging = true
        didDrag = false
        dragThumbOffsetY = thumbRect.height / 2
        pendingPageAction = local.y >= bounds.midY
            ? "scroll_page_up"
            : "scroll_page_down"
    }

    override func mouseDragged(with event: NSEvent) {
        guard isDragging else { return }
        didDrag = true
        pendingPageAction = nil
        let local = convert(event.locationInWindow, from: nil)
        scrollToThumbMinY(local.y - dragThumbOffsetY)
    }

    override func mouseUp(with event: NSEvent) {
        super.mouseUp(with: event)
        if !didDrag, let pendingPageAction {
            performScrollAction(pendingPageAction)
        }
        isDragging = false
        didDrag = false
        dragThumbOffsetY = 0
        pendingPageAction = nil
        isHovered = bounds.contains(convert(event.locationInWindow, from: nil))
    }

    func update(_ nextState: TerminalScrollbarState) {
        state = nextState
        isHidden = !isScrollable
        needsDisplay = true
    }

    private var trackRect: NSRect {
        let visualWidth = min(TerminalContainerLayout.scrollbarVisualWidth, bounds.width)
        let verticalInset = min(TerminalContainerLayout.scrollbarVerticalInset, bounds.height / 2)
        return NSRect(
            x: bounds.maxX - visualWidth - TerminalContainerLayout.scrollbarRightInset,
            y: bounds.minY + verticalInset,
            width: visualWidth,
            height: max(bounds.height - verticalInset * 2, 0)
        )
    }

    private var thumbRect: NSRect? {
        guard let state,
              state.total > state.length,
              state.length > 0 else { return nil }

        let track = trackRect
        guard track.height > 0, track.width > 0 else { return nil }

        let proportion = min(
            max(CGFloat(Double(state.length) / Double(state.total)), 0),
            1
        )
        let thumbHeight = min(
            track.height,
            max(TerminalContainerLayout.minThumbLength, track.height * proportion)
        )
        let maxOffset = state.total - state.length
        let scrollValue = maxOffset == 0
            ? 0
            : min(max(CGFloat(Double(state.offset) / Double(maxOffset)), 0), 1)
        let travel = max(track.height - thumbHeight, 0)
        let thumbY = track.maxY - thumbHeight - travel * scrollValue
        let paintedWidth = min(TerminalContainerLayout.scrollbarPaintedWidth, track.width)
        return NSRect(
            x: track.maxX - paintedWidth,
            y: thumbY,
            width: paintedWidth,
            height: thumbHeight
        )
    }

    private func scrollToThumbMinY(_ proposedMinY: CGFloat) {
        guard let state,
              state.total > state.length,
              state.length > 0,
              let thumbRect else { return }

        let track = trackRect
        let travel = max(track.height - thumbRect.height, 0)
        guard travel > 0 else { return }

        let clampedMinY = min(
            max(proposedMinY, track.minY),
            track.maxY - thumbRect.height
        )
        let scrollValue = min(
            max((track.maxY - thumbRect.height - clampedMinY) / travel, 0),
            1
        )
        let maxOffset = state.total - state.length
        let targetOffset = UInt64((Double(scrollValue) * Double(maxOffset)).rounded())
        let cappedTarget = min(targetOffset, UInt64(Int64.max))
        let cappedCurrent = min(state.offset, UInt64(Int64.max))
        let delta = Int64(cappedTarget) - Int64(cappedCurrent)
        guard delta != 0 else { return }
        performScrollAction("scroll_page_lines:\(delta)")
    }

    @discardableResult
    private func performScrollAction(_ action: String) -> Bool {
        terminalView?.performBindingAction(action) ?? false
    }

    private func thumbHitRect(for thumbRect: NSRect) -> NSRect {
        NSRect(
            x: bounds.minX,
            y: thumbRect.minY,
            width: bounds.width,
            height: thumbRect.height
        )
    }
}
