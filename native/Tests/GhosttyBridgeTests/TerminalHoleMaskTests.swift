import AppKit
@testable import GhosttyBridge
import XCTest

@MainActor
final class TerminalHoleMaskTests: XCTestCase {
    private let impl = GhosttyBridgeImpl.shared

    // MARK: - Pure geometry

    func testOverlayInsideTerminalSplitsHoleWithoutLosingArea() {
        let terminal = NSRect(x: 0, y: 72, width: 640, height: 728)
        let overlay = NSRect(x: 100, y: 100, width: 50, height: 40)

        let holes = TerminalHoleMask.holeRects(terminals: [terminal], overlays: [overlay])

        XCTAssertEqual(holes.count, 4)
        let area = holes.reduce(CGFloat(0)) { $0 + $1.width * $1.height }
        XCTAssertEqual(area, terminal.width * terminal.height - overlay.width * overlay.height)
        for hole in holes {
            XCTAssertTrue(hole.intersection(overlay).isEmpty)
        }
    }

    func testOverlayOutsideTerminalLeavesOneHole() {
        let terminal = NSRect(x: 0, y: 0, width: 100, height: 100)
        let overlays = [
            NSRect(x: 500, y: 500, width: 20, height: 20),
            NSRect(x: -50, y: 200, width: 30, height: 30),
        ]

        XCTAssertEqual(
            TerminalHoleMask.holeRects(terminals: [terminal], overlays: overlays),
            [terminal]
        )
    }

    func testOverlayCoveringTerminalRemovesHole() {
        let terminal = NSRect(x: 20, y: 20, width: 100, height: 60)
        let overlay = NSRect(x: 0, y: 0, width: 400, height: 400)

        XCTAssertTrue(
            TerminalHoleMask.holeRects(terminals: [terminal], overlays: [overlay]).isEmpty
        )
    }

    func testOverlappingTerminalRectsMergeIntoOneHole() {
        let holes = TerminalHoleMask.holeRects(
            terminals: [
                NSRect(x: 0, y: 0, width: 100, height: 100),
                NSRect(x: 50, y: 50, width: 100, height: 100),
            ],
            overlays: []
        )

        // even-odd 下重叠洞会把交集翻回可见，必须先合并成不相交矩形。
        XCTAssertEqual(holes, [NSRect(x: 0, y: 0, width: 150, height: 150)])
    }

    func testSubtractHandlesNonOverlappingCutter() {
        let rect = NSRect(x: 10, y: 10, width: 30, height: 30)
        XCTAssertEqual(
            TerminalHoleMask.subtract(rect, NSRect(x: 100, y: 100, width: 10, height: 10)),
            [rect]
        )
    }

    func testLayerRectFlipsTopLeftIntoBottomLeft() {
        let window = makeWindow(browserWindowId: 5101)
        defer { impl.detachWindow(parent: window) }
        let contentView = window.contentView!
        let compositor = insertWebCompositorStandIn(in: window)

        let local = TerminalHoleMask.layerRect(
            NSRect(x: 10, y: 72, width: 100, height: 200),
            contentView: contentView,
            compositor: compositor
        )

        // contentView 高 600，未翻转 → mask 路径 y = 600 - 72 - 200。
        XCTAssertEqual(local.minX, 10)
        XCTAssertEqual(local.minY, 600 - 72 - 200)
        XCTAssertEqual(local.width, 100)
        XCTAssertEqual(local.height, 200)
    }

    // MARK: - Bridge wiring

    func testApplyWindowStateInstallsMaskAndClearsWhenTerminalHidden() throws {
        let window = makeWindow(browserWindowId: 5102)
        defer { impl.detachWindow(parent: window) }
        insertWebCompositorStandIn(in: window)
        createTerminal("terminal-a", in: window)

        let visibleTerminals = """
        [
          { "focused": true, "frame": { "height": 200, "width": 300, "x": 10, "y": 20 }, "panelId": "terminal-a", "visible": true }
        ]
        """
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 1, terminals: visibleTerminals)
            ),
            .applied
        )

        let mask = try XCTUnwrap(compositor(in: window)?.layer?.mask as? CAShapeLayer)
        XCTAssertEqual(mask.fillRule, .evenOdd)
        XCTAssertNotNil(mask.path)

        var payload = try holeMaskPayload(window)
        XCTAssertEqual(payload["active"] as? Bool, true)
        XCTAssertEqual(payload["cutRectCount"] as? Int, 1)
        let rects = try XCTUnwrap(payload["cutRects"] as? [[String: Double]])
        XCTAssertEqual(rects.first?["x"], 10)
        XCTAssertEqual(rects.first?["y"], 20)
        XCTAssertEqual(rects.first?["width"], 300)
        XCTAssertEqual(rects.first?["height"], 200)

        let hiddenTerminals = """
        [
          { "focused": true, "frame": { "height": 200, "width": 300, "x": 10, "y": 20 }, "panelId": "terminal-a", "visible": false }
        ]
        """
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 2, terminals: hiddenTerminals)
            ),
            .applied
        )

        XCTAssertNil(compositor(in: window)?.layer?.mask)
        payload = try holeMaskPayload(window)
        XCTAssertEqual(payload["active"] as? Bool, false)
        XCTAssertEqual(payload["cutRectCount"] as? Int, 0)
    }

    func testApplyWindowStateReAddsRegisteredOverlayArea() throws {
        let window = makeWindow(browserWindowId: 5103)
        defer { impl.detachWindow(parent: window) }
        insertWebCompositorStandIn(in: window)
        createTerminal("terminal-a", in: window)

        let terminals = """
        [
          { "focused": true, "frame": { "height": 200, "width": 300, "x": 10, "y": 20 }, "panelId": "terminal-a", "visible": true }
        ]
        """
        let overlays = """
        [{ "frame": { "height": 30, "width": 80, "x": 10, "y": 20 }, "id": "menu" }]
        """
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 1, terminals: terminals, overlays: overlays)
            ),
            .applied
        )

        let payload = try holeMaskPayload(window)
        // 300×200 的终端减去左上角 80×30 的浮层 → 2 个洞。
        XCTAssertEqual(payload["cutRectCount"] as? Int, 2)
        let rects = try XCTUnwrap(payload["cutRects"] as? [[String: Double]])
        let holeArea = rects.reduce(0.0) { $0 + ($1["width"] ?? 0) * ($1["height"] ?? 0) }
        XCTAssertEqual(holeArea, 300 * 200 - 80 * 30)
    }

    func testCloseAllClearsMask() throws {
        let window = makeWindow(browserWindowId: 5104)
        defer { impl.detachWindow(parent: window) }
        insertWebCompositorStandIn(in: window)
        createTerminal("terminal-a", in: window)

        let terminals = """
        [
          { "focused": true, "frame": { "height": 200, "width": 300, "x": 10, "y": 20 }, "panelId": "terminal-a", "visible": true }
        ]
        """
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 1, terminals: terminals)
            ),
            .applied
        )
        XCTAssertNotNil(compositor(in: window)?.layer?.mask)

        impl.closeAll(parent: window)

        XCTAssertNil(compositor(in: window)?.layer?.mask)
    }

    // MARK: - Helpers

    private func makeWindow(browserWindowId: Int) -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        XCTAssertTrue(impl.setupWindow(parent: window, browserWindowId: browserWindowId))
        return window
    }

    private func createTerminal(_ panelId: String, in window: NSWindow) {
        XCTAssertTrue(
            impl.createTerminal(
                parent: window,
                panelId: panelId,
                viewport: NSRect(x: 10, y: 20, width: 300, height: 200),
                fontFamily: "Menlo",
                fontSize: 13,
                workingDirectory: nil,
                command: nil,
                environment: [:],
                lifecycleId: "",
                hostManaged: true
            )
        )
    }

    private func stateJSON(
        sequence: Int,
        terminals: String = "[]",
        overlays: String = "[]"
    ) -> String {
        """
        {
          "keyboardTarget": { "kind": "terminal", "panelId": "terminal-a" },
          "nativeApplySequence": \(sequence),
          "reason": "dockview-active-panel",
          "rendererSequence": \(sequence),
          "terminals": \(terminals),
          "webOverlayRects": \(overlays),
          "windowFocused": true
        }
        """
    }

    private func compositor(in window: NSWindow) -> NSView? {
        window.contentView?.subviews.first {
            String(describing: type(of: $0)).contains("ViewsCompositorSuperview")
        }
    }

    private func holeMaskPayload(_ window: NSWindow) throws -> [String: Any] {
        let data = try XCTUnwrap(impl.debugSnapshot(parent: window).data(using: .utf8))
        let snapshot = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        let windowPayload = try XCTUnwrap(snapshot["window"] as? [String: Any])
        return try XCTUnwrap(windowPayload["holeMask"] as? [String: Any])
    }
}
