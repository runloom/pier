import AppKit
@testable import GhosttyBridge
import GhosttyTerminal
import XCTest

@MainActor
private final class FocusRecordingDelegate: TerminalSurfaceFocusDelegate {
    private(set) var focusEvents: [Bool] = []

    func terminalDidChangeFocus(_ focused: Bool) {
        focusEvents.append(focused)
    }
}

private final class TestKeyWindow: NSWindow {
    override var isKeyWindow: Bool { true }
}

private final class DebugLogCapture: @unchecked Sendable {
    private(set) var messages: [String] = []

    func append(_ message: String) {
        messages.append(message)
    }
}

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

    func testInactiveHostKeyboardStatePublishesInitialUnfocusedSurfaceState() {
        let terminalView = TerminalView(frame: NSRect(x: 0, y: 0, width: 320, height: 200))
        let delegate = FocusRecordingDelegate()
        terminalView.delegate = delegate

        terminalView.hostKeyboardActive = false

        XCTAssertEqual(delegate.focusEvents, [false])
    }

    func testInactiveHostFocusAppliesToSurfaceCreatedAfterInitialSync() {
        let previousEnabled = TerminalDebugLog.isEnabled
        let previousCategories = TerminalDebugLog.categories
        let previousSink = TerminalDebugLog.sink
        let logs = DebugLogCapture()
        TerminalDebugLog.sink = { logs.append($0) }
        TerminalDebugLog.enable(.lifecycle)
        defer {
            TerminalDebugLog.sink = previousSink
            TerminalDebugLog.categories = previousCategories
            TerminalDebugLog.isEnabled = previousEnabled
        }

        let terminalView = TerminalView(frame: NSRect(x: 0, y: 0, width: 320, height: 200))
        let window = TestKeyWindow(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 200),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        terminalView.configuration = TerminalSurfaceOptions(
            backend: .inMemory(
                InMemoryTerminalSession(write: { _ in }, resize: { _ in })
            )
        )
        terminalView.controller = TerminalController()
        terminalView.hostKeyboardActive = false

        window.contentView?.addSubview(terminalView)
        defer { window.orderOut(nil) }

        XCTAssertTrue(
            logs.messages.contains { $0.contains("surface focus=false") }
        )
    }

    func testHostFocusPublishesActiveSurfaceState() {
        let terminalView = TerminalView(frame: NSRect(x: 0, y: 0, width: 320, height: 200))
        let delegate = FocusRecordingDelegate()
        let window = TestKeyWindow(
            contentRect: NSRect(x: 0, y: 0, width: 320, height: 200),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.contentView?.addSubview(terminalView)
        terminalView.delegate = delegate
        defer { window.orderOut(nil) }

        window.makeFirstResponder(terminalView)
        terminalView.synchronizeHostFocusState()

        XCTAssertEqual(delegate.focusEvents, [true])
    }

    func testHostFocusSuppressesDuplicateSurfaceState() {
        let terminalView = TerminalView(frame: NSRect(x: 0, y: 0, width: 320, height: 200))
        let delegate = FocusRecordingDelegate()
        terminalView.delegate = delegate

        terminalView.hostKeyboardActive = false
        terminalView.synchronizeHostFocusState()
        terminalView.synchronizeHostFocusState()

        XCTAssertEqual(delegate.focusEvents, [false])
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
        XCTAssertEqual(container.subviews.count, 2)
        let scrollView = try XCTUnwrap(container.subviews.first as? AppTerminalScrollView)
        XCTAssertEqual(scrollView.frame, NSRect(x: 0, y: 0, width: 480, height: 320))
        XCTAssertEqual(terminalView.frame, NSRect(x: 0, y: 0, width: 480, height: 320))
        XCTAssertEqual(container.subviews.last?.frame, container.bounds)
    }

    func testPresentationGateStartsCoveredAndRejectsStaleFrame() {
        var gate = TerminalPresentationGate()
        let initial = TerminalFramePresentationRequest(
            pixelHeight: 600,
            pixelWidth: 960,
            requestSequence: 1,
            surfaceGeneration: 3
        )
        gate.request(initial)

        XCTAssertTrue(gate.isCovered)
        XCTAssertFalse(
            gate.commit(
                TerminalFramePresentation(
                    drawSequence: 8,
                    pixelHeight: 600,
                    pixelWidth: 960,
                    requestSequence: 1,
                    surfaceGeneration: 2
                )
            )
        )
        XCTAssertTrue(gate.isCovered)
    }

    func testPresentationGateOnlyRevealsLatestMatchingFrame() {
        var gate = TerminalPresentationGate()
        gate.request(
            TerminalFramePresentationRequest(
                pixelHeight: 600,
                pixelWidth: 960,
                requestSequence: 1,
                surfaceGeneration: 3
            )
        )
        gate.request(
            TerminalFramePresentationRequest(
                pixelHeight: 720,
                pixelWidth: 1_200,
                requestSequence: 2,
                surfaceGeneration: 3
            )
        )

        XCTAssertFalse(
            gate.commit(
                TerminalFramePresentation(
                    drawSequence: 9,
                    pixelHeight: 600,
                    pixelWidth: 960,
                    requestSequence: 1,
                    surfaceGeneration: 3
                )
            )
        )
        XCTAssertTrue(gate.isCovered)
        XCTAssertTrue(
            gate.commit(
                TerminalFramePresentation(
                    drawSequence: 10,
                    pixelHeight: 720,
                    pixelWidth: 1_200,
                    requestSequence: 2,
                    surfaceGeneration: 3
                )
            )
        )
        XCTAssertFalse(gate.isCovered)
    }

    func testPresentationGateRearmsForSameSurfaceVisibilityCycle() {
        var gate = TerminalPresentationGate()
        let firstRequest = TerminalFramePresentationRequest(
            pixelHeight: 600,
            pixelWidth: 960,
            requestSequence: 1,
            surfaceGeneration: 3
        )
        gate.request(firstRequest)
        XCTAssertTrue(
            gate.commit(
                TerminalFramePresentation(
                    drawSequence: 10,
                    pixelHeight: 600,
                    pixelWidth: 960,
                    requestSequence: 1,
                    surfaceGeneration: 3
                )
            )
        )
        XCTAssertFalse(gate.isCovered)

        gate.rearm()

        XCTAssertTrue(gate.isCovered)
        XCTAssertFalse(
            gate.commit(
                TerminalFramePresentation(
                    drawSequence: 11,
                    pixelHeight: 600,
                    pixelWidth: 960,
                    requestSequence: 1,
                    surfaceGeneration: 3
                )
            )
        )
        XCTAssertTrue(gate.isCovered)

        gate.request(
            TerminalFramePresentationRequest(
                pixelHeight: 600,
                pixelWidth: 960,
                requestSequence: 2,
                surfaceGeneration: 3
            )
        )
        XCTAssertTrue(
            gate.commit(
                TerminalFramePresentation(
                    drawSequence: 12,
                    pixelHeight: 600,
                    pixelWidth: 960,
                    requestSequence: 2,
                    surfaceGeneration: 3
                )
            )
        )
        XCTAssertFalse(gate.isCovered)
    }

    func testPresentationGateRecoversCoverForRebuiltSurface() {
        var gate = TerminalPresentationGate()
        let firstRequest = TerminalFramePresentationRequest(
            pixelHeight: 600,
            pixelWidth: 960,
            requestSequence: 1,
            surfaceGeneration: 3
        )
        gate.request(firstRequest)
        XCTAssertTrue(
            gate.commit(
                TerminalFramePresentation(
                    drawSequence: 1,
                    pixelHeight: 600,
                    pixelWidth: 960,
                    requestSequence: 1,
                    surfaceGeneration: 3
                )
            )
        )

        gate.request(
            TerminalFramePresentationRequest(
                pixelHeight: 600,
                pixelWidth: 960,
                requestSequence: 2,
                surfaceGeneration: 5
            )
        )

        XCTAssertTrue(gate.isCovered)
    }

    func testContainerKeepsPresentationCoverUntilMatchingFrame() {
        let terminalView = TerminalView(frame: .zero)
        let container = TerminalContainerView(
            frame: NSRect(x: 0, y: 0, width: 480, height: 320),
            terminalView: terminalView,
            panelId: "terminal-1",
            browserWindowId: 42
        )
        let request = TerminalFramePresentationRequest(
            pixelHeight: 640,
            pixelWidth: 960,
            requestSequence: 4,
            surfaceGeneration: 7
        )

        container.handlePresentationRequest(request)
        container.handleFramePresentation(
            TerminalFramePresentation(
                drawSequence: 10,
                pixelHeight: 600,
                pixelWidth: 900,
                requestSequence: 3,
                surfaceGeneration: 7
            )
        )

        XCTAssertTrue(container.isPresentationCovered)

        container.handleFramePresentation(
            TerminalFramePresentation(
                drawSequence: 11,
                pixelHeight: 640,
                pixelWidth: 960,
                requestSequence: 4,
                surfaceGeneration: 7
            )
        )

        XCTAssertFalse(container.isPresentationCovered)
    }

    func testContainerPreparesCoverBeforeRestoringVisibility() {
        let terminalView = TerminalView(frame: .zero)
        let container = TerminalContainerView(
            frame: NSRect(x: 0, y: 0, width: 480, height: 320),
            terminalView: terminalView,
            panelId: "terminal-1",
            browserWindowId: 42
        )
        let request = TerminalFramePresentationRequest(
            pixelHeight: 640,
            pixelWidth: 960,
            requestSequence: 1,
            surfaceGeneration: 3
        )
        container.handlePresentationRequest(request)
        container.handleFramePresentation(
            TerminalFramePresentation(
                drawSequence: 10,
                pixelHeight: 640,
                pixelWidth: 960,
                requestSequence: 1,
                surfaceGeneration: 3
            )
        )
        XCTAssertFalse(container.isPresentationCovered)

        container.prepareForVisibilityPresentation()

        XCTAssertTrue(container.isPresentationCovered)
    }

    func testContainerRecoversPresentationCoverForNewSurfaceGeneration() {
        let terminalView = TerminalView(frame: .zero)
        let container = TerminalContainerView(
            frame: NSRect(x: 0, y: 0, width: 480, height: 320),
            terminalView: terminalView,
            panelId: "terminal-1",
            browserWindowId: 42
        )
        let firstRequest = TerminalFramePresentationRequest(
            pixelHeight: 640,
            pixelWidth: 960,
            requestSequence: 1,
            surfaceGeneration: 1
        )
        container.handlePresentationRequest(firstRequest)
        container.handleFramePresentation(
            TerminalFramePresentation(
                drawSequence: 1,
                pixelHeight: 640,
                pixelWidth: 960,
                requestSequence: 1,
                surfaceGeneration: 1
            )
        )
        XCTAssertFalse(container.isPresentationCovered)

        container.handlePresentationRequest(
            TerminalFramePresentationRequest(
                pixelHeight: 640,
                pixelWidth: 960,
                requestSequence: 2,
                surfaceGeneration: 3
            )
        )

        XCTAssertTrue(container.isPresentationCovered)
    }

    func testContainerAutomaticallyRevealsAfterMatchingRealFrame() async throws {
        let terminalView = TerminalView(frame: .zero)
        terminalView.configuration = TerminalSurfaceOptions(
            backend: .inMemory(
                InMemoryTerminalSession(write: { _ in }, resize: { _ in })
            )
        )
        terminalView.controller = TerminalController()
        let container = TerminalContainerView(
            frame: NSRect(x: 0, y: 0, width: 480, height: 320),
            terminalView: terminalView,
            panelId: "terminal-1",
            browserWindowId: 42
        )
        let window = TestKeyWindow(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 320),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        try XCTUnwrap(window.contentView).addSubview(container)
        terminalView.setSurfaceVisible(true)
        defer { window.orderOut(nil) }

        let revealed = await waitUntil {
            !container.isPresentationCovered
        }

        XCTAssertTrue(revealed)
    }

    func testContainerForwardsOnlyCommittedCurrentFrame() {
        let terminalView = TerminalView(frame: .zero)
        let container = TerminalContainerView(
            frame: NSRect(x: 0, y: 0, width: 480, height: 320),
            terminalView: terminalView,
            panelId: "terminal-1",
            browserWindowId: 42,
            presentationId: 17
        )
        let request = TerminalFramePresentationRequest(
            pixelHeight: 640,
            pixelWidth: 960,
            requestSequence: 4,
            surfaceGeneration: 7
        )
        var forwarded:
            (browserWindowId: Int, panelId: String, presentationId: UInt64,
             presentation: TerminalFramePresentation)?
        let previousCallback = TerminalContainerView.forwardFrameCommittedCallback
        TerminalContainerView.forwardFrameCommittedCallback = {
            browserWindowId, panelId, presentationId, presentation in
            forwarded = (browserWindowId, panelId, presentationId, presentation)
        }
        defer {
            TerminalContainerView.forwardFrameCommittedCallback = previousCallback
        }

        container.handlePresentationRequest(request)
        container.handleFramePresentation(
            TerminalFramePresentation(
                drawSequence: 11,
                pixelHeight: 640,
                pixelWidth: 960,
                requestSequence: 4,
                surfaceGeneration: 7
            )
        )

        XCTAssertEqual(forwarded?.browserWindowId, 42)
        XCTAssertEqual(forwarded?.panelId, "terminal-1")
        XCTAssertEqual(forwarded?.presentationId, 17)
        XCTAssertEqual(forwarded?.presentation.requestSequence, 4)
    }

    func testContainerForwardsOneCommittedFramePerPresentationLifecycle() {
        let terminalView = TerminalView(frame: .zero)
        let container = TerminalContainerView(
            frame: NSRect(x: 0, y: 0, width: 480, height: 320),
            terminalView: terminalView,
            panelId: "terminal-1",
            browserWindowId: 42,
            presentationId: 17
        )
        let request = TerminalFramePresentationRequest(
            pixelHeight: 640,
            pixelWidth: 960,
            requestSequence: 4,
            surfaceGeneration: 7
        )
        let presentation = TerminalFramePresentation(
            drawSequence: 11,
            pixelHeight: 640,
            pixelWidth: 960,
            requestSequence: 4,
            surfaceGeneration: 7
        )
        var forwardedPresentationIds: [UInt64] = []
        let previousCallback = TerminalContainerView.forwardFrameCommittedCallback
        TerminalContainerView.forwardFrameCommittedCallback = {
            _, _, presentationId, _ in
            forwardedPresentationIds.append(presentationId)
        }
        defer {
            TerminalContainerView.forwardFrameCommittedCallback = previousCallback
        }

        container.handlePresentationRequest(request)
        container.handleFramePresentation(presentation)
        container.handleFramePresentation(presentation)
        container.updatePresentationId(17)
        container.handleFramePresentation(presentation)
        container.handleFramePresentation(presentation)

        XCTAssertEqual(forwardedPresentationIds, [17, 17])
    }

    func testScrollbarStateIsForwardedToSPMScrollView() throws {
        let (container, scrollView) = try makeContainer()
        let state = TerminalScrollbarState(total: 1_000, offset: 100, length: 100)

        container.terminalScrollbarStateDidChange(state)

        XCTAssertEqual(scrollView.scrollbarState, state)
        XCTAssertEqual(container.subviews.count, 2)
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

    func testNativeScrollerInteractionForwardsTerminalFocusIntent() throws {
        let (_, scrollView) = try makeContainer()
        scrollView.applyScrollbarState(TerminalScrollbarState(total: 1_000, offset: 0, length: 80))

        let previousCallback = TerminalContainerView.forwardFocusRequestCallback
        var focusRequest: (browserWindowId: Int, panelId: String)?
        TerminalContainerView.forwardFocusRequestCallback = { browserWindowId, panelId in
            focusRequest = (browserWindowId, panelId)
        }
        defer {
            TerminalContainerView.forwardFocusRequestCallback = previousCallback
        }

        scrollView.triggerScrollerInteractionForTesting()

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

    private func waitUntil(
        timeout: TimeInterval = 2,
        condition: @escaping @MainActor () -> Bool
    ) async -> Bool {
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        while ProcessInfo.processInfo.systemUptime < deadline {
            if condition() {
                return true
            }
            await withCheckedContinuation { continuation in
                DispatchQueue.main.async {
                    continuation.resume()
                }
            }
        }
        return condition()
    }
}
