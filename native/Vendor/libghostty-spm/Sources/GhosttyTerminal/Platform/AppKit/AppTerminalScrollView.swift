//
//  AppTerminalScrollView.swift
//  libghostty-spm
//
//  Native AppKit scrollbar wrapper for AppTerminalView.
//

#if canImport(AppKit) && !canImport(UIKit)
    import AppKit

    /// Wraps a terminal view in `NSScrollView` so macOS owns scrollbar behavior.
    ///
    /// The document view represents the full scrollback height while the terminal
    /// renderer stays sized to the visible viewport. This mirrors Ghostty's
    /// macOS strategy and lets AppKit handle overlay appearance, fade timing,
    /// gestures, and scroller hit testing.
    @MainActor
    public final class AppTerminalScrollView: NSView {
        public let terminalView: TerminalView
        public private(set) var scrollbarState: TerminalScrollbarState?
        public var onScrollerInteraction: (() -> Void)?

        private let scrollView = FocusNotifyingScrollView()
        private let documentView = NSView()
        private var isLiveScrolling = false
        private var lastSentRow: Int?

        public init(terminalView: TerminalView) {
            self.terminalView = terminalView
            super.init(frame: .zero)
            configureViews()
            configureObservers()
        }

        @available(*, unavailable)
        public required init?(coder _: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }

        deinit {
            NotificationCenter.default.removeObserver(self)
        }

        public override var isOpaque: Bool { true }

        public override var safeAreaInsets: NSEdgeInsets {
            NSEdgeInsetsZero
        }

        public override func acceptsFirstMouse(for _: NSEvent?) -> Bool {
            true
        }

        public override func layout() {
            super.layout()
            synchronizeLayout()
        }

        public func applyScrollbarState(_ state: TerminalScrollbarState) {
            scrollbarState = state
            // Scrollbar updates must only move the document/scroller — never
            // re-fit the surface. Upstream Ghostty SurfaceScrollView keeps the
            // same decoupling; unconditional fitToSize here caused a per-frame
            // refresh storm once scrollback grew.
            synchronizeScrollChrome()
            updateTrackingAreas()
        }

        public func synchronizeLayout() {
            scrollView.frame = bounds
            let nextTerminalSize = scrollView.contentSize
            let terminalSizeChanged = terminalView.frame.size != nextTerminalSize
            terminalView.frame.size = nextTerminalSize
            documentView.frame.size.width = scrollView.bounds.width
            synchronizeScrollView()
            synchronizeTerminalView()
            if terminalSizeChanged {
                terminalView.fitToSize()
            }
        }

        private func synchronizeScrollChrome() {
            scrollView.frame = bounds
            documentView.frame.size.width = scrollView.bounds.width
            synchronizeScrollView()
            synchronizeTerminalView()
        }

        public func isScrollerHitTarget(_ view: NSView?) -> Bool {
            guard isScrollable, let scroller = scrollView.verticalScroller else { return false }
            var current = view
            while let candidate = current {
                if candidate === scroller { return true }
                current = candidate.superview
            }
            return false
        }

        public override func scrollWheel(with event: NSEvent) {
            guard isScrollable, terminalView.surface?.isMouseCaptured != true else {
                terminalView.scrollWheel(with: event)
                return
            }
            scrollView.scrollWheel(with: event)
        }

        public override func mouseMoved(with event: NSEvent) {
            guard NSScroller.preferredScrollerStyle == .legacy else { return }
            scrollView.flashScrollers()
        }

        #if DEBUG
            public func triggerScrollerInteractionForTesting() {
                scrollView.notifyScrollerInteraction()
            }
        #endif

        public override func updateTrackingAreas() {
            trackingAreas.forEach { removeTrackingArea($0) }
            super.updateTrackingAreas()

            guard isScrollable, let scroller = scrollView.verticalScroller else { return }
            let scrollerRect = convert(scroller.bounds, from: scroller)
            guard !scrollerRect.isEmpty else { return }
            addTrackingArea(
                NSTrackingArea(
                    rect: scrollerRect,
                    options: [.mouseMoved, .activeInKeyWindow],
                    owner: self,
                    userInfo: nil
                )
            )
        }

        private func configureViews() {
            wantsLayer = true
            layer?.backgroundColor = NSColor.black.cgColor

            scrollView.hasVerticalScroller = true
            scrollView.hasHorizontalScroller = false
            scrollView.autohidesScrollers = true
            scrollView.usesPredominantAxisScrolling = true
            scrollView.drawsBackground = false
            scrollView.contentView.clipsToBounds = false
            scrollView.shouldNotifyScrollerInteraction = { [weak self] in
                self?.isScrollable == true
            }
            scrollView.onScrollerInteraction = { [weak self] in
                self?.onScrollerInteraction?()
            }
            scrollView.scrollerStyle = .overlay
            scrollView.documentView = documentView

            documentView.addSubview(terminalView)
            addSubview(scrollView)
        }

        public func applyHostBackgroundColor(_ color: NSColor) {
            layer?.backgroundColor = color.cgColor
            terminalView.applyHostBackgroundColor(color)
        }

        private func configureObservers() {
            scrollView.contentView.postsBoundsChangedNotifications = true
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(scrollViewBoundsDidChange),
                name: NSView.boundsDidChangeNotification,
                object: scrollView.contentView
            )
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(scrollViewWillStartLiveScroll),
                name: NSScrollView.willStartLiveScrollNotification,
                object: scrollView
            )
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(scrollViewDidEndLiveScroll),
                name: NSScrollView.didEndLiveScrollNotification,
                object: scrollView
            )
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(scrollViewDidLiveScroll),
                name: NSScrollView.didLiveScrollNotification,
                object: scrollView
            )
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(preferredScrollerStyleDidChange),
                name: NSScroller.preferredScrollerStyleDidChangeNotification,
                object: nil
            )
        }

        private func synchronizeTerminalView() {
            terminalView.frame.origin = scrollView.contentView.documentVisibleRect.origin
        }

        private func synchronizeScrollView() {
            documentView.frame.size.height = documentHeight()

            if !isLiveScrolling,
               let scrollbarState,
               cellHeight > 0,
               isScrollable
            {
                let clampedOffset = min(scrollbarState.offset, maxOffsetRows(for: scrollbarState))
                let bottomRows = scrollbarState.total
                    - min(scrollbarState.total, clampedOffset + scrollbarState.length)
                let offsetY = CGFloat(bottomRows) * cellHeight
                scrollView.contentView.scroll(to: CGPoint(x: 0, y: offsetY))
                lastSentRow = cappedInt(clampedOffset)
            }

            scrollView.reflectScrolledClipView(scrollView.contentView)
        }

        @objc private func scrollViewBoundsDidChange(_: Notification) {
            synchronizeTerminalView()
        }

        @objc private func scrollViewWillStartLiveScroll(_: Notification) {
            isLiveScrolling = true
        }

        @objc private func scrollViewDidEndLiveScroll(_: Notification) {
            isLiveScrolling = false
            synchronizeScrollView()
        }

        @objc private func scrollViewDidLiveScroll(_: Notification) {
            handleLiveScroll()
        }

        @objc private func preferredScrollerStyleDidChange(_: Notification) {
            scrollView.scrollerStyle = .overlay
            synchronizeLayout()
            updateTrackingAreas()
        }

        private func handleLiveScroll() {
            guard let scrollbarState, isScrollable, cellHeight > 0 else { return }

            let visibleRect = scrollView.contentView.documentVisibleRect
            let scrollOffset = max(
                documentView.frame.height - visibleRect.origin.y - visibleRect.height,
                0
            )
            let rawRow = UInt64((scrollOffset / cellHeight).rounded(.down))
            let row = min(rawRow, maxOffsetRows(for: scrollbarState))
            let intRow = cappedInt(row)
            guard intRow != lastSentRow else { return }

            lastSentRow = intRow
            _ = terminalView.performBindingAction("scroll_to_row:\(intRow)")
        }

        private func documentHeight() -> CGFloat {
            let contentHeight = scrollView.contentSize.height
            guard let scrollbarState, cellHeight > 0 else {
                return contentHeight
            }

            let documentGridHeight = CGFloat(scrollbarState.total) * cellHeight
            let viewportGridHeight = CGFloat(scrollbarState.length) * cellHeight
            let padding = contentHeight - viewportGridHeight
            return max(contentHeight, documentGridHeight + padding)
        }

        private var isScrollable: Bool {
            guard let scrollbarState else { return false }
            return scrollbarState.total > scrollbarState.length
                && scrollbarState.length > 0
        }

        private var cellHeight: CGFloat {
            guard let metrics = terminalView.surface?.size(),
                  metrics.cellHeightPixels > 0 else { return 0 }

            let scale = terminalView.window?.backingScaleFactor
                ?? NSScreen.main?.backingScaleFactor ?? 2.0
            guard scale > 0 else { return 0 }
            return CGFloat(metrics.cellHeightPixels) / scale
        }

        private func maxOffsetRows(for state: TerminalScrollbarState) -> UInt64 {
            guard state.total > state.length else { return 0 }
            return state.total - state.length
        }

        private func cappedInt(_ value: UInt64) -> Int {
            value > UInt64(Int.max) ? Int.max : Int(value)
        }
    }

    private final class FocusNotifyingScrollView: NSScrollView {
        var shouldNotifyScrollerInteraction: () -> Bool = { true }
        var onScrollerInteraction: (() -> Void)?

        override func hitTest(_ point: NSPoint) -> NSView? {
            let target = super.hitTest(point)
            guard NSApp.currentEvent?.type == .leftMouseDown else {
                return target
            }
            notifyScrollerInteraction(for: target)
            return target
        }

        func notifyScrollerInteraction() {
            guard shouldNotifyScrollerInteraction() else { return }
            onScrollerInteraction?()
        }

        private func notifyScrollerInteraction(for view: NSView?) {
            guard shouldNotifyScrollerInteraction(), isVerticalScrollerTarget(view) else {
                return
            }
            onScrollerInteraction?()
        }

        private func isVerticalScrollerTarget(_ view: NSView?) -> Bool {
            guard let scroller = verticalScroller else { return false }
            var current = view
            while let candidate = current {
                if candidate === scroller { return true }
                current = candidate.superview
            }
            return false
        }
    }
#endif
