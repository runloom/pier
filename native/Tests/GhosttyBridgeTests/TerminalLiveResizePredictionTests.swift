import AppKit
@testable import GhosttyBridge
import XCTest

final class TerminalLiveResizePredictionTests: XCTestCase {
    func testExpandsRightAndBottomEdgesWithBleed() {
        let predicted = TerminalLiveResizePredictor.predict(
            lastFrame: NSRect(x: 500, y: 0, width: 300, height: 600),
            oldContentSize: NSSize(width: 800, height: 600),
            newContentSize: NSSize(width: 900, height: 700)
        )

        XCTAssertEqual(predicted, NSRect(x: 500, y: -2, width: 402, height: 702))
    }

    func testKeepsTopAnchoredPanelsAgainstTheTopEdge() {
        let predicted = TerminalLiveResizePredictor.predict(
            lastFrame: NSRect(x: 0, y: 300, width: 400, height: 300),
            oldContentSize: NSSize(width: 800, height: 600),
            newContentSize: NSSize(width: 800, height: 700)
        )

        XCTAssertEqual(predicted, NSRect(x: 0, y: 400, width: 400, height: 300))
    }

    func testLeavesInteriorPanelsUntouched() {
        let frame = NSRect(x: 100, y: 100, width: 300, height: 200)
        let predicted = TerminalLiveResizePredictor.predict(
            lastFrame: frame,
            oldContentSize: NSSize(width: 800, height: 600),
            newContentSize: NSSize(width: 900, height: 700)
        )

        XCTAssertEqual(predicted, frame)
    }

    func testLiveResizePredictionDoesNotAdvanceAuthoritativeLayout() {
        var state = TerminalLayoutState(
            authoritativeContentSize: NSSize(width: 800, height: 600),
            authoritativeFrame: NSRect(x: 500, y: 0, width: 300, height: 600)
        )

        let predicted = state.predictProvisionalFrame(
            newContentSize: NSSize(width: 900, height: 700)
        )

        XCTAssertEqual(predicted, NSRect(x: 500, y: -2, width: 402, height: 702))
        XCTAssertEqual(state.authoritativeContentSize, NSSize(width: 800, height: 600))
        XCTAssertEqual(state.authoritativeFrame, NSRect(x: 500, y: 0, width: 300, height: 600))
        XCTAssertEqual(state.presentedFrame, predicted)

        let finalFrame = NSRect(x: 500, y: 0, width: 400, height: 700)
        state.rememberAuthoritativeLayout(
            contentSize: NSSize(width: 900, height: 700),
            frame: finalFrame
        )

        XCTAssertEqual(state.authoritativeContentSize, NSSize(width: 900, height: 700))
        XCTAssertEqual(state.authoritativeFrame, finalFrame)
        XCTAssertEqual(state.presentedFrame, finalFrame)
    }
}
