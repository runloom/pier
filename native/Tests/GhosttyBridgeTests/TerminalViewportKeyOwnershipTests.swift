import AppKit
import GhosttyTerminal
import XCTest

/// Host NSScrollView chrome must not steal unmodified arrows / Page keys
/// from the PTY (Cursor / Codex menus). Wheel and scroller drag stay on
/// the scroll view; keyboard document navigation must not move the clip.
@MainActor
final class TerminalViewportKeyOwnershipTests: XCTestCase {
    private final class KeyRecordingTerminalView: TerminalView {
        var keyDownCount = 0
        var keyUpCount = 0

        override func keyDown(with event: NSEvent) {
            keyDownCount += 1
        }

        override func keyUp(with event: NSEvent) {
            keyUpCount += 1
        }
    }

    func testNativeScrollChromeRejectsFirstResponder() throws {
        let (_, native) = makeScrollableChrome()

        XCTAssertFalse(native.acceptsFirstResponder)
        XCTAssertFalse(native.canBecomeKeyView)
    }

    func testArrowDownOnScrollChromeForwardsToTerminalAndDoesNotMoveClip() throws {
        let (terminal, native) = makeScrollableChrome()
        let originBefore = pinDocumentAwayFromEdge(native)

        native.keyDown(with: try makeKeyEvent(type: .keyDown, keyCode: 0x7D))
        native.keyUp(with: try makeKeyEvent(type: .keyUp, keyCode: 0x7D))

        XCTAssertEqual(terminal.keyDownCount, 1)
        XCTAssertEqual(terminal.keyUpCount, 1)
        XCTAssertEqual(native.contentView.documentVisibleRect.origin, originBefore)
    }

    func testPageDownSelectorDoesNotMoveClipOrEmitScrollToRow() throws {
        let (_, native) = makeScrollableChrome()
        let originBefore = pinDocumentAwayFromEdge(native)

        native.pageDown(nil)
        native.scrollLineDown(nil)
        native.scrollPageDown(nil)
        native.moveDown(nil)

        XCTAssertEqual(native.contentView.documentVisibleRect.origin, originBefore)
    }

    private func makeScrollableChrome() -> (KeyRecordingTerminalView, NSScrollView) {
        let terminalView = KeyRecordingTerminalView(frame: .zero)
        let scrollView = AppTerminalScrollView(terminalView: terminalView)
        scrollView.frame = NSRect(x: 0, y: 0, width: 480, height: 320)
        scrollView.synchronizeLayout()
        scrollView.applyScrollbarState(
            TerminalScrollbarState(total: 1_000, offset: 200, length: 80)
        )
        let native = scrollView.subviews.compactMap { $0 as? NSScrollView }.first
        precondition(native != nil, "AppTerminalScrollView must own an NSScrollView")
        return (terminalView, native!)
    }

    @discardableResult
    private func pinDocumentAwayFromEdge(_ native: NSScrollView) -> NSPoint {
        native.documentView?.setFrameSize(NSSize(width: 480, height: 4_000))
        native.contentView.scroll(to: CGPoint(x: 0, y: 200))
        native.reflectScrolledClipView(native.contentView)
        return native.contentView.documentVisibleRect.origin
    }

    private func makeKeyEvent(type: NSEvent.EventType, keyCode: UInt16) throws -> NSEvent {
        try XCTUnwrap(
            NSEvent.keyEvent(
                with: type,
                location: .zero,
                modifierFlags: [],
                timestamp: 0,
                windowNumber: 0,
                context: nil,
                characters: "",
                charactersIgnoringModifiers: "",
                isARepeat: false,
                keyCode: keyCode
            )
        )
    }
}
