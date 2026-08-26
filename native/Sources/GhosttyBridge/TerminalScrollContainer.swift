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
private final class TerminalPresentationCoverView: NSView {
    override var isOpaque: Bool { true }

    override func hitTest(_: NSPoint) -> NSView? {
        nil
    }
}

struct TerminalPresentationGate {
    private var expected: TerminalFramePresentationRequest?
    private(set) var isCovered = true

    mutating func rearm() {
        expected = nil
        isCovered = true
    }

    mutating func request(_ request: TerminalFramePresentationRequest) {
        if expected?.surfaceGeneration != request.surfaceGeneration {
            isCovered = true
        }
        expected = request
    }

    @discardableResult
    mutating func commit(_ presentation: TerminalFramePresentation) -> Bool {
        guard let expected,
              presentation.surfaceGeneration == expected.surfaceGeneration,
              presentation.requestSequence == expected.requestSequence,
              presentation.pixelWidth == expected.pixelWidth,
              presentation.pixelHeight == expected.pixelHeight
        else {
            return false
        }
        isCovered = false
        return true
    }

    /// Failsafe when requestSequence / 1px mismatch keeps the cover stuck.
    mutating func forceUncover() {
        isCovered = false
    }
}

@MainActor
final class TerminalContainerView: NSView, TerminalScrollbarStateSink {
    static var forwardFocusRequestCallback: ((Int, String) -> Void)?
    static var forwardFrameCommittedCallback:
        ((Int, String, UInt64, TerminalFramePresentation) -> Void)?

    let terminalView: TerminalView
    private let terminalScrollView: AppTerminalScrollView
    private let presentationCoverView = TerminalPresentationCoverView(frame: .zero)
    private var presentationGate = TerminalPresentationGate()
    private var presentationCoverTimeoutWorkItem: DispatchWorkItem?
    /// Matches renderer restore-ack timeout; stuck covers must not last forever.
    private static let presentationCoverTimeoutSeconds: TimeInterval = 0.5
    private(set) var browserWindowId: Int
    private(set) var panelId: String
    private(set) var presentationId: UInt64
    private var capturedTerminalMouseButton: TerminalMouseButton?
    private var lastForwardedPresentationId: UInt64?
    /// Sibling EventRouterView — web overlay geometry for hitTest + mouse gate.
    weak var eventRouter: EventRouterView?

    var backgroundColor: NSColor = .black {
        didSet {
            layer?.backgroundColor = backgroundColor.cgColor
            presentationCoverView.layer?.backgroundColor = backgroundColor.cgColor
            terminalScrollView.applyHostBackgroundColor(backgroundColor)
        }
    }

    var isPresentationCovered: Bool {
        presentationGate.isCovered
    }

    init(
        frame frameRect: NSRect,
        terminalView: TerminalView,
        panelId: String,
        browserWindowId: Int,
        presentationId: UInt64 = 0
    ) {
        self.terminalView = terminalView
        terminalScrollView = AppTerminalScrollView(terminalView: terminalView)
        self.panelId = panelId
        self.browserWindowId = browserWindowId
        self.presentationId = presentationId
        super.init(frame: frameRect)

        wantsLayer = true
        layer?.backgroundColor = backgroundColor.cgColor

        terminalScrollView.onScrollerInteraction = { [weak self] in
            self?.activateFocusIntent()
        }
        terminalView.onFramePresentationRequested = { [weak self] request in
            self?.handlePresentationRequest(request)
        }
        terminalView.onFramePresented = { [weak self] presentation in
            self?.handleFramePresentation(presentation)
        }
        addSubview(terminalScrollView)
        terminalScrollView.applyHostBackgroundColor(backgroundColor)

        presentationCoverView.wantsLayer = true
        presentationCoverView.layer?.backgroundColor = backgroundColor.cgColor
        addSubview(presentationCoverView, positioned: .above, relativeTo: terminalScrollView)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var isOpaque: Bool { true }

    override func acceptsFirstMouse(for _: NSEvent?) -> Bool {
        true
    }

    override func layout() {
        super.layout()
        synchronizeChildFrames()
    }

    func applyHostFrame(_ hostFrame: NSRect) {
        // Spurious presentation republishes (same viewport) used to call
        // flushHostResizeFrame → synchronous Metal resize/render and flash.
        if frame.equalTo(hostFrame) {
            return
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        frame = hostFrame
        synchronizeChildFrames()
        terminalView.flushHostResizeFrame()
        CATransaction.commit()
    }

    func prepareForVisibilityPresentation() {
        presentationGate.rearm()
        showPresentationCover()
    }

    func handlePresentationRequest(_ request: TerminalFramePresentationRequest) {
        presentationGate.request(request)
        guard presentationGate.isCovered else { return }
        showPresentationCover()
    }

    func handleFramePresentation(_ presentation: TerminalFramePresentation) {
        guard presentationGate.commit(presentation) else { return }
        hidePresentationCover()
        guard lastForwardedPresentationId != presentationId else { return }
        lastForwardedPresentationId = presentationId
        Self.forwardFrameCommittedCallback?(
            browserWindowId,
            panelId,
            presentationId,
            presentation
        )
    }

    private func showPresentationCover() {
        presentationCoverView.layer?.isHidden = false
        schedulePresentationCoverTimeout()
    }

    private func hidePresentationCover() {
        presentationCoverTimeoutWorkItem?.cancel()
        presentationCoverTimeoutWorkItem = nil
        presentationCoverView.layer?.isHidden = true
    }

    private func schedulePresentationCoverTimeout() {
        presentationCoverTimeoutWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            guard self.presentationGate.isCovered else { return }
            self.presentationGate.forceUncover()
            self.presentationCoverView.layer?.isHidden = true
            self.presentationCoverTimeoutWorkItem = nil
        }
        presentationCoverTimeoutWorkItem = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + Self.presentationCoverTimeoutSeconds,
            execute: work
        )
    }

    func updateBrowserWindowId(_ browserWindowId: Int) {
        self.browserWindowId = browserWindowId
    }

    func updatePanelId(_ panelId: String) {
        self.panelId = panelId
    }

    func updatePresentationId(_ presentationId: UInt64) {
        self.presentationId = presentationId
        lastForwardedPresentationId = nil
    }

    private func synchronizeChildFrames() {
        terminalScrollView.frame = bounds
        terminalScrollView.synchronizeLayout()
        presentationCoverView.frame = bounds
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard !isHidden, alphaValue > 0 else { return nil }
        let local = if let superview {
            convert(point, from: superview)
        } else {
            point
        }
        guard bounds.contains(local) else { return nil }

        // Defense in depth: if hit testing fell through a transparent web
        // layer onto this container, still refuse hits under web overlays
        // (dialog scrim / menus). EventRouterView already prioritizes overlays
        // when it is the top hit-test participant.
        if isUnderWebOverlay(localPoint: local) {
            return nil
        }

        let scrollPoint = terminalScrollView.convert(local, from: self)
        if let target = terminalScrollView.hitTest(scrollPoint),
           terminalScrollView.isScrollerHitTarget(target)
        {
            return target
        }

        return self
    }

    private func isUnderWebOverlay(localPoint: NSPoint) -> Bool {
        guard let eventRouter else { return false }
        return eventRouter.containsWebOverlay(atWindowPoint: convert(localPoint, to: nil))
    }

    private func isUnderWebOverlay(event: NSEvent) -> Bool {
        eventRouter?.containsWebOverlay(atWindowPoint: event.locationInWindow) == true
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
        if isUnderWebOverlay(event: event) {
            return false
        }
        let local = convert(event.locationInWindow, from: nil)
        guard bounds.contains(local) else { return false }

        let scrollPoint = terminalScrollView.convert(local, from: self)
        guard let target = terminalScrollView.hitTest(scrollPoint) else {
            return true
        }
        return !terminalScrollView.isScrollerHitTarget(target)
    }
}
