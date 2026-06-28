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

    func testApplyHostFrameSynchronizesContainerAndChildFramesImmediately() {
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
        XCTAssertEqual(terminalView.frame, NSRect(x: 0, y: 0, width: 480, height: 320))
        XCTAssertEqual(
            container.subviews[1].frame,
            NSRect(x: 466, y: 0, width: 14, height: 320)
        )
    }

    func testTerminalContainerHitTargetRoutesScrollbarOnlyWhenScrollable() {
        let bounds = NSRect(x: 0, y: 0, width: 480, height: 320)
        let scrollbarPoint = NSPoint(x: 472, y: 160)
        let terminalPoint = NSPoint(x: 120, y: 160)
        let outsidePoint = NSPoint(x: 500, y: 160)

        XCTAssertEqual(
            TerminalContainerLayout.hitTarget(
                at: scrollbarPoint,
                in: bounds,
                scrollbarActive: true
            ),
            .scrollbar
        )
        XCTAssertEqual(
            TerminalContainerLayout.hitTarget(
                at: scrollbarPoint,
                in: bounds,
                scrollbarActive: false
            ),
            .terminal
        )
        XCTAssertEqual(
            TerminalContainerLayout.hitTarget(
                at: terminalPoint,
                in: bounds,
                scrollbarActive: true
            ),
            .terminal
        )
        XCTAssertNil(
            TerminalContainerLayout.hitTarget(
                at: outsidePoint,
                in: bounds,
                scrollbarActive: true
            )
        )
    }
}
