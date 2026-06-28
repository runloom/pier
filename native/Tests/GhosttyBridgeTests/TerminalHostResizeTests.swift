import AppKit
@testable import GhosttyBridge
import GhosttyTerminal
import XCTest

@MainActor
final class TerminalHostResizeTests: XCTestCase {
    private final class WheelRecordingTerminalView: TerminalView {
        var scrollWheelCallCount = 0

        override func scrollWheel(with event: NSEvent) {
            scrollWheelCallCount += 1
        }
    }

    private func makeContainer() throws -> (TerminalContainerView, AppTerminalScrollView) {
        let terminalView = TerminalView(frame: .zero)
        let container = TerminalContainerView(
            frame: NSRect(x: 0, y: 0, width: 100, height: 80),
            terminalView: terminalView,
            panelId: "terminal-1",
            browserWindowId: 42
        )
        container.applyHostFrame(NSRect(x: 0, y: 0, width: 480, height: 320))
        let scrollView = try XCTUnwrap(container.subviews.first as? AppTerminalScrollView)
        return (container, scrollView)
    }

    func testFlushHostResizeFrameIsSafeWithoutAttachedSurface() {
        let terminalView = TerminalView(frame: NSRect(x: 0, y: 0, width: 320, height: 200))

        XCTAssertNoThrow(terminalView.flushHostResizeFrame())
    }

    func testApplyHostFrameSynchronizesContainerAndChildFramesImmediately() throws {
        let terminalView = TerminalView(frame: .zero)
        let container = TerminalContainerView(
            frame: NSRect(x: 0, y: 0, width: 100, height: 80),
            terminalView: terminalView,
            panelId: "terminal-1",
            browserWindowId: 42
        )

        let hostFrame = NSRect(x: 12, y: 18, width: 480, height: 320)
        container.applyHostFrame(hostFrame)

        XCTAssertEqual(container.frame, hostFrame)
        XCTAssertEqual(container.subviews.count, 1)
        let scrollView = try XCTUnwrap(container.subviews.first as? AppTerminalScrollView)
        XCTAssertEqual(scrollView.frame, NSRect(x: 0, y: 0, width: 480, height: 320))
        XCTAssertEqual(terminalView.frame, NSRect(x: 0, y: 0, width: 480, height: 320))
    }

    func testScrollbarStateIsForwardedToSPMScrollView() throws {
        let (container, scrollView) = try makeContainer()
        let state = TerminalScrollbarState(total: 1_000, offset: 100, length: 100)

        container.terminalScrollbarStateDidChange(state)

        XCTAssertEqual(scrollView.scrollbarState, state)
        XCTAssertEqual(container.subviews.count, 1)
    }

    func testSPMScrollViewOwnsNativeOverlayScroller() throws {
        let (_, scrollView) = try makeContainer()
        let nativeScrollView = try XCTUnwrap(scrollView.subviews.first as? NSScrollView)

        XCTAssertEqual(nativeScrollView.scrollerStyle, .overlay)
        XCTAssertTrue(nativeScrollView.hasVerticalScroller)
        XCTAssertFalse(nativeScrollView.hasHorizontalScroller)
        XCTAssertTrue(nativeScrollView.autohidesScrollers)
    }

    func testScrollerHitTargetIsDisabledWhenScrollbarIsNotScrollable() throws {
        let (_, scrollView) = try makeContainer()
        let nativeScrollView = try XCTUnwrap(scrollView.subviews.first as? NSScrollView)
        let nativeScroller = try XCTUnwrap(nativeScrollView.verticalScroller)

        scrollView.applyScrollbarState(TerminalScrollbarState(total: 80, offset: 0, length: 80))

        XCTAssertFalse(scrollView.isScrollerHitTarget(nativeScroller))
    }

    func testScrollerHitTargetIsEnabledWhenScrollbarIsScrollable() throws {
        let (_, scrollView) = try makeContainer()
        let nativeScrollView = try XCTUnwrap(scrollView.subviews.first as? NSScrollView)
        let nativeScroller = try XCTUnwrap(nativeScrollView.verticalScroller)

        scrollView.applyScrollbarState(TerminalScrollbarState(total: 1_000, offset: 0, length: 80))

        XCTAssertTrue(scrollView.isScrollerHitTarget(nativeScroller))
    }

    func testScrollWheelForwardsToTerminalInputWhenScrollbarIsNotScrollable() throws {
        let terminalView = WheelRecordingTerminalView(frame: .zero)
        let scrollView = AppTerminalScrollView(terminalView: terminalView)
        scrollView.frame = NSRect(x: 0, y: 0, width: 480, height: 320)
        scrollView.synchronizeLayout()
        scrollView.applyScrollbarState(TerminalScrollbarState(total: 80, offset: 0, length: 80))

        scrollView.scrollWheel(with: try makeScrollWheelEvent())

        XCTAssertEqual(terminalView.scrollWheelCallCount, 1)
    }

    func testNativeScrollerInteractionActivatesTerminalFocus() throws {
        let (_, scrollView) = try makeContainer()
        scrollView.applyScrollbarState(TerminalScrollbarState(total: 1_000, offset: 0, length: 80))

        let previousLocalFocusCallback = TerminalContainerView.localFocusCallback
        let previousCallback = TerminalContainerView.forwardFocusRequestCallback
        var locallyFocusedPanelId: String?
        var focusRequest: (browserWindowId: Int, panelId: String)?
        TerminalContainerView.localFocusCallback = { panelId in
            locallyFocusedPanelId = panelId
        }
        TerminalContainerView.forwardFocusRequestCallback = { browserWindowId, panelId in
            focusRequest = (browserWindowId, panelId)
        }
        defer {
            TerminalContainerView.localFocusCallback = previousLocalFocusCallback
            TerminalContainerView.forwardFocusRequestCallback = previousCallback
        }

        scrollView.triggerScrollerInteractionForTesting()

        XCTAssertEqual(locallyFocusedPanelId, "terminal-1")
        XCTAssertEqual(focusRequest?.browserWindowId, 42)
        XCTAssertEqual(focusRequest?.panelId, "terminal-1")
    }

    private func makeScrollWheelEvent() throws -> NSEvent {
        let cgEvent = try XCTUnwrap(CGEvent(
            scrollWheelEvent2Source: nil,
            units: .pixel,
            wheelCount: 1,
            wheel1: -1,
            wheel2: 0,
            wheel3: 0
        ))
        cgEvent.location = CGPoint(x: 200, y: 160)
        return try XCTUnwrap(NSEvent(cgEvent: cgEvent))
    }
}
