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
}
