import AppKit
@testable import GhosttyBridge
import GhosttyTerminal
import XCTest

@MainActor
final class TerminalHostResizeTests: XCTestCase {
    func testFlushHostResizeFrameIsSafeWithoutAttachedSurface() {
        let terminalView = TerminalView(frame: NSRect(x: 0, y: 0, width: 320, height: 200))

        XCTAssertNoThrow(terminalView.flushHostResizeFrame())
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
