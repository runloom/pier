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

    func testRoundedOverlayCornerOverTerminalIsAHole() {
        // 圆角外的角若留在矩形回填里，看到的是不透明 backing。角必须挖回洞，
        // 并且只挖和终端相交的部分；曲线上那圈对着 backing 烘焙的脏边也要吃掉。
        let terminal = NSRect(x: 0, y: 0, width: 400, height: 300)
        let card = NSRect(x: 100, y: 40, width: 200, height: 160)
        let path = TerminalHoleMask.cornerHolePath(
            overlays: [(rect: card, radius: 24)],
            terminals: [terminal]
        )

        XCTAssertTrue(path.contains(CGPoint(x: 101, y: 41), using: .winding))
        // 原圆角曲线中点附近：半径 24 的弧在 outset 之后应落进洞。
        XCTAssertTrue(path.contains(CGPoint(x: 107, y: 47), using: .winding))
        XCTAssertFalse(path.contains(CGPoint(x: 200, y: 120), using: .winding))

        let clipped = TerminalHoleMask.cornerHolePath(
            overlays: [(rect: card, radius: 24)],
            terminals: [NSRect(x: 150, y: 0, width: 250, height: 300)]
        )
        XCTAssertFalse(clipped.contains(CGPoint(x: 101, y: 41), using: .winding))
    }

    func testCornerWedgeUnderAnotherOverlayIsNotAHole() {
        // toast 胶囊（大圆角）和上层菜单回填区重叠时：落进菜单回填的楔不能挖，
        // 否则 even-odd 会把菜单卡片自己的像素打穿露出终端。
        let terminal = NSRect(x: 0, y: 0, width: 400, height: 300)
        let toast = NSRect(x: 40, y: 40, width: 120, height: 36)
        let menu = NSRect(x: 140, y: 20, width: 160, height: 200)
        let path = TerminalHoleMask.cornerHolePath(
            overlays: [
                (rect: toast, radius: 18),
                (rect: menu, radius: 12),
            ],
            terminals: [terminal]
        )
        // toast 右缘的楔大部分落在 menu box 内 → 必须排除。
        XCTAssertFalse(
            path.contains(CGPoint(x: 150, y: 50), using: .winding)
        )
        // menu 自身的圆角楔在终端里、不在别的回填内 → 仍是洞。
        XCTAssertTrue(path.contains(CGPoint(x: 141, y: 21), using: .winding))
    }

    func testOverlayCoveringTerminalStillCarvesCornerWedges() {
        // 卡片完全盖住终端：holeRects 为空也不能整张摘 mask，圆角楔还要挖，
        // 否则 1pt outset 与圆角弧外的角在终端四角露兜底色。
        // 卡片与终端同大：终端的角就是卡片的角，弧外必被挖。
        let terminal = NSRect(x: 0, y: 0, width: 200, height: 120)
        let card = NSRect(x: 0, y: 0, width: 200, height: 120)
        let holes = TerminalHoleMask.holeRects(
            terminals: [terminal],
            overlays: [card]
        )
        XCTAssertTrue(holes.isEmpty)
        let corners = TerminalHoleMask.cornerHolePath(
            overlays: [(rect: card, radius: 16)],
            terminals: [terminal]
        )
        // 圆角中心 (17,17)，半径 17+1；弧外点 (1,1) 应是洞。
        XCTAssertTrue(corners.contains(CGPoint(x: 1, y: 1), using: .winding))
        // 弧内点（卡片像素区）不是洞。
        XCTAssertFalse(corners.contains(CGPoint(x: 17, y: 17), using: .winding))
    }

    func testShadowShapeExpandsBySpreadAndCollapsesWhenEaten() {
        // 正 spread 外扩，圆角跟着加；负 spread 把形状吃掉就不该再画一层实心投影。
        let expanded = TerminalShadow.shape(
            frame: NSRect(x: 10, y: 20, width: 100, height: 40),
            radius: 12,
            spread: 4
        )
        XCTAssertEqual(expanded?.rect, NSRect(x: 6, y: 16, width: 108, height: 48))
        XCTAssertEqual(expanded?.radius, 16)
        XCTAssertEqual(TerminalShadow.layerBlur(15), 7.5)

        let eaten = TerminalShadow.shape(
            frame: NSRect(x: 0, y: 0, width: 10, height: 10),
            radius: 4,
            spread: -8
        )
        XCTAssertNil(eaten)
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

    func testScrimDimsTerminalHoleWithoutFillingIt() throws {
        let window = makeWindow(browserWindowId: 5105)
        defer { impl.detachWindow(parent: window) }
        insertWebCompositorStandIn(in: window)
        createTerminal("terminal-a", in: window)

        let terminals = """
        [
          { "focused": true, "frame": { "height": 200, "width": 300, "x": 10, "y": 20 }, "panelId": "terminal-a", "visible": true }
        ]
        """
        // 整窗蒙层 paints:false，另加一张不透明卡片。洞仍按卡片挖开；
        // 蒙层本身不回填，只在终端矩形上留下同色半透明。
        let overlays = """
        [
          { "frame": { "height": 600, "width": 800, "x": 0, "y": 0 }, "id": "dialog-scrim", "paints": false, "scrim": { "a": 0.1, "b": 1, "g": 1, "r": 1 } },
          { "frame": { "height": 40, "width": 80, "x": 100, "y": 80 }, "id": "dialog-card", "paints": true }
        ]
        """
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 1, terminals: terminals, overlays: overlays)
            ),
            .applied
        )

        let hole = try holeMaskPayload(window)
        XCTAssertEqual(hole["cutRectCount"] as? Int, 4)
        let holeRects = try XCTUnwrap(hole["cutRects"] as? [[String: Double]])
        let holeArea = holeRects.reduce(0.0) { $0 + ($1["width"] ?? 0) * ($1["height"] ?? 0) }
        XCTAssertEqual(holeArea, 300 * 200 - 80 * 40)

        let scrim = try scrimPayload(window)
        XCTAssertEqual(scrim["active"] as? Bool, true)
        let washes = try XCTUnwrap(scrim["rects"] as? [[String: Double]])
        XCTAssertEqual(washes.count, 1)
        XCTAssertEqual(washes[0]["x"], 10)
        XCTAssertEqual(washes[0]["y"], 20)
        XCTAssertEqual(washes[0]["width"], 300)
        XCTAssertEqual(washes[0]["height"], 200)
        XCTAssertEqual(washes[0]["r"], 1)
        XCTAssertEqual(washes[0]["g"], 1)
        XCTAssertEqual(washes[0]["b"], 1)
        XCTAssertEqual(washes[0]["a"], 0.1)

        let scrimView = try XCTUnwrap(
            window.contentView?.subviews.first {
                String(describing: type(of: $0)).contains("TerminalScrim")
            }
        )
        let washLayer = try XCTUnwrap(scrimView.layer?.sublayers?.first)
        // contentView 高 600、未翻转：top-left y=20 落到 layer y=380。
        XCTAssertEqual(washLayer.frame.minX, 10)
        XCTAssertEqual(washLayer.frame.minY, 600 - 20 - 200)
        XCTAssertEqual(washLayer.frame.width, 300)
        XCTAssertEqual(washLayer.frame.height, 200)

        let order = window.contentView?.subviews.map {
            String(describing: type(of: $0))
        } ?? []
        let scrimIndex = try XCTUnwrap(order.firstIndex { $0.contains("TerminalScrim") })
        let compositorIndex = try XCTUnwrap(
            order.firstIndex { $0.contains("ViewsCompositorSuperview") }
        )
        XCTAssertLessThan(scrimIndex, compositorIndex)
    }

    func testOutsetShadowPaintsOnTheTerminalWithoutFillingTheHole() throws {
        // 阴影在 border box 外。扩回填矩形会把半透明像素铺到不透明 backing 上；
        // 洞面积必须仍是「终端 − 卡片」，投影单独画在合成层下面。
        let window = makeWindow(browserWindowId: 5109)
        defer { impl.detachWindow(parent: window) }
        insertWebCompositorStandIn(in: window)
        createTerminal("terminal-a", in: window)

        let terminals = """
        [
          { "focused": true, "frame": { "height": 400, "width": 500, "x": 0, "y": 0 }, "panelId": "terminal-a", "visible": true }
        ]
        """
        let overlays = """
        [
          { "frame": { "height": 600, "width": 800, "x": 0, "y": 0 }, "id": "menu-capture", "paints": false, "scrim": { "a": 0.1, "b": 1, "g": 1, "r": 1 } },
          {
            "frame": { "height": 120, "width": 200, "x": 100, "y": 80 },
            "id": "menu",
            "paints": true,
            "radius": 16,
            "shadows": [
              { "blur": 0, "color": { "a": 1, "b": 0, "g": 0, "r": 0 }, "spread": 0, "x": 0, "y": 0 },
              { "blur": 10, "color": { "a": 0.25, "b": 0, "g": 0, "r": 0 }, "spread": 4, "x": 0, "y": 8 }
            ]
          }
        ]
        """
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 1, terminals: terminals, overlays: overlays)
            ),
            .applied
        )

        let hole = try holeMaskPayload(window)
        let holeRects = try XCTUnwrap(hole["cutRects"] as? [[String: Double]])
        let holeArea = holeRects.reduce(0.0) { $0 + ($1["width"] ?? 0) * ($1["height"] ?? 0) }
        XCTAssertEqual(holeArea, 500 * 400 - 200 * 120)

        let shadowView = try XCTUnwrap(
            window.contentView?.subviews.first {
                String(describing: type(of: $0)).contains("TerminalShadow")
            }
        )
        XCTAssertNil(shadowView.hitTest(NSPoint(x: 10, y: 10)))
        let layer = try XCTUnwrap(shadowView.layer?.sublayers?.first)
        // spread 4：形状 (96, 76, 208×128)。contentView 高 600、未翻转。
        XCTAssertEqual(layer.frame.minX, 96)
        XCTAssertEqual(layer.frame.minY, 600 - 76 - 128)
        XCTAssertEqual(layer.frame.width, 208)
        XCTAssertEqual(layer.frame.height, 128)
        XCTAssertEqual(layer.shadowRadius, 5)
        XCTAssertEqual(layer.shadowOffset, CGSize(width: 0, height: -8))
        XCTAssertEqual(layer.shadowOpacity, 0.25)
        XCTAssertEqual(shadowView.layer?.sublayers?.count, 1)

        let order = window.contentView?.subviews.map {
            String(describing: type(of: $0))
        } ?? []
        let shadowIndex = try XCTUnwrap(order.firstIndex { $0.contains("TerminalShadow") })
        let scrimIndex = try XCTUnwrap(order.firstIndex { $0.contains("TerminalScrim") })
        let compositorIndex = try XCTUnwrap(
            order.firstIndex { $0.contains("ViewsCompositorSuperview") }
        )
        XCTAssertLessThan(scrimIndex, shadowIndex)
        XCTAssertLessThan(shadowIndex, compositorIndex)
    }

    func testScrimInsertedBelowExistingShadowWhenAppliedLater() throws {
        // Dialog 蒙层和 toast 阴影可能任意先后出现。蒙层要压暗洞里的一切，
        // 包括浮层投影：后挂的 scrim 必须插进已有 shadow 之下，而不是合成层
        // 旁边（那会把 scrim 抬到 shadow 上面，投影在洞里不跟着变暗）。
        let window = makeWindow(browserWindowId: 5111)
        defer { impl.detachWindow(parent: window) }
        insertWebCompositorStandIn(in: window)
        createTerminal("terminal-a", in: window)

        let terminals = """
        [
          { "focused": true, "frame": { "height": 400, "width": 500, "x": 0, "y": 0 }, "panelId": "terminal-a", "visible": true }
        ]
        """
        let shadowOnly = """
        [
          {
            "frame": { "height": 100, "width": 160, "x": 60, "y": 60 },
            "id": "toast",
            "paints": true,
            "shadows": [
              { "blur": 10, "color": { "a": 0.25, "b": 0, "g": 0, "r": 0 }, "spread": 0, "x": 0, "y": 8 }
            ]
          }
        ]
        """
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 1, terminals: terminals, overlays: shadowOnly)
            ),
            .applied
        )

        let withScrim = """
        [
          { "frame": { "height": 600, "width": 800, "x": 0, "y": 0 }, "id": "dialog-scrim", "paints": false, "scrim": { "a": 0.1, "b": 1, "g": 1, "r": 1 } },
          {
            "frame": { "height": 100, "width": 160, "x": 60, "y": 60 },
            "id": "toast",
            "paints": true,
            "shadows": [
              { "blur": 10, "color": { "a": 0.25, "b": 0, "g": 0, "r": 0 }, "spread": 0, "x": 0, "y": 8 }
            ]
          }
        ]
        """
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 2, terminals: terminals, overlays: withScrim)
            ),
            .applied
        )

        let order = window.contentView?.subviews.map {
            String(describing: type(of: $0))
        } ?? []
        let shadowIndex = try XCTUnwrap(order.firstIndex { $0.contains("TerminalShadow") })
        let scrimIndex = try XCTUnwrap(order.firstIndex { $0.contains("TerminalScrim") })
        XCTAssertLessThan(scrimIndex, shadowIndex)
    }

    func testInputCaptureOverlayDoesNotPaintAShadow() throws {
        let window = makeWindow(browserWindowId: 5110)
        defer { impl.detachWindow(parent: window) }
        insertWebCompositorStandIn(in: window)
        createTerminal("terminal-a", in: window)

        let terminals = """
        [
          { "focused": true, "frame": { "height": 200, "width": 300, "x": 10, "y": 20 }, "panelId": "terminal-a", "visible": true }
        ]
        """
        let overlays = """
        [
          {
            "frame": { "height": 600, "width": 800, "x": 0, "y": 0 },
            "id": "capture",
            "paints": false,
            "shadows": [
              { "blur": 12, "color": { "a": 0.4, "b": 0, "g": 0, "r": 0 }, "spread": 0, "x": 0, "y": 8 }
            ]
          }
        ]
        """
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 1, terminals: terminals, overlays: overlays)
            ),
            .applied
        )
        XCTAssertFalse(
            window.contentView?.subviews.contains {
                String(describing: type(of: $0)).contains("TerminalShadow")
            } ?? false
        )
    }

    func testInputCaptureOverlayDoesNotDimTerminal() throws {
        let window = makeWindow(browserWindowId: 5106)
        defer { impl.detachWindow(parent: window) }
        insertWebCompositorStandIn(in: window)
        createTerminal("terminal-a", in: window)

        let terminals = """
        [
          { "focused": true, "frame": { "height": 200, "width": 300, "x": 10, "y": 20 }, "panelId": "terminal-a", "visible": true }
        ]
        """
        let overlays = """
        [
          { "frame": { "height": 600, "width": 800, "x": 0, "y": 0 }, "id": "menu-capture", "paints": false }
        ]
        """
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 1, terminals: terminals, overlays: overlays)
            ),
            .applied
        )

        let scrim = try scrimPayload(window)
        XCTAssertEqual(scrim["active"] as? Bool, false)
        let hole = try holeMaskPayload(window)
        XCTAssertEqual(hole["cutRectCount"] as? Int, 1)
    }

    func testScrimClearsWhenOverlayGoesAway() throws {
        let window = makeWindow(browserWindowId: 5107)
        defer { impl.detachWindow(parent: window) }
        insertWebCompositorStandIn(in: window)
        createTerminal("terminal-a", in: window)

        let terminals = """
        [
          { "focused": true, "frame": { "height": 200, "width": 300, "x": 10, "y": 20 }, "panelId": "terminal-a", "visible": true }
        ]
        """
        let overlays = """
        [
          { "frame": { "height": 600, "width": 800, "x": 0, "y": 0 }, "id": "dialog-scrim", "paints": false, "scrim": { "a": 0.22, "b": 0, "g": 0, "r": 0 } }
        ]
        """
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 1, terminals: terminals, overlays: overlays)
            ),
            .applied
        )
        XCTAssertEqual(try scrimPayload(window)["active"] as? Bool, true)

        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 2, terminals: terminals, overlays: "[]")
            ),
            .applied
        )
        XCTAssertEqual(try scrimPayload(window)["active"] as? Bool, false)
        XCTAssertFalse(
            window.contentView?.subviews.contains {
                String(describing: type(of: $0)).contains("TerminalScrim")
            } ?? false
        )
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

    private func scrimPayload(_ window: NSWindow) throws -> [String: Any] {
        let data = try XCTUnwrap(impl.debugSnapshot(parent: window).data(using: .utf8))
        let snapshot = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
        let windowPayload = try XCTUnwrap(snapshot["window"] as? [String: Any])
        return (windowPayload["scrim"] as? [String: Any]) ?? ["active": false]
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
