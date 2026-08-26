import AppKit
@testable import GhosttyBridge
import XCTest

@MainActor
final class TerminalWindowStateTests: XCTestCase {
    private let impl = GhosttyBridgeImpl.shared

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
        keyboardTarget: String,
        targetPanelId: String? = nil,
        terminals: String = "[]",
        overlays: String = "[]",
        windowFocused: Bool = true
    ) -> String {
        let panelField = targetPanelId.map { ", \"panelId\": \"\($0)\"" } ?? ""
        return """
        {
          "keyboardTarget": { "kind": "\(keyboardTarget)"\(panelField) },
          "nativeApplySequence": \(sequence),
          "reason": "dockview-active-panel",
          "rendererSequence": \(sequence),
          "terminals": \(terminals),
          "webOverlayRects": \(overlays),
          "windowFocused": \(windowFocused)
        }
        """
    }

    private func debugSnapshot(_ window: NSWindow) throws -> [String: Any] {
        let data = try XCTUnwrap(impl.debugSnapshot(parent: window).data(using: .utf8))
        return try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
    }

    func testWindowStateRejectsInvalidStaleAndDuplicateSequences() {
        let window = makeWindow(browserWindowId: 4101)
        defer { impl.detachWindow(parent: window) }

        XCTAssertEqual(impl.applyWindowState(parent: window, json: "{"), .error)
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 2, keyboardTarget: "web")
            ),
            .applied
        )
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 2, keyboardTarget: "web")
            ),
            .unchanged
        )
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(sequence: 1, keyboardTarget: "web")
            ),
            .stale
        )
    }

    func testAtomicApplySynchronizesGeometryRoutingAndUniqueTerminalFocus() throws {
        let window = makeWindow(browserWindowId: 4102)
        defer { impl.detachWindow(parent: window) }
        createTerminal("terminal-a", in: window)
        createTerminal("terminal-b", in: window)
        let terminals = """
        [
          { "focused": true, "frame": { "height": 200, "width": 300, "x": 10, "y": 20 }, "panelId": "terminal-a", "visible": true },
          { "focused": false, "frame": { "height": 180, "width": 280, "x": 330, "y": 40 }, "panelId": "terminal-b", "visible": true }
        ]
        """
        let overlays = """
        [{ "frame": { "height": 30, "width": 80, "x": 0, "y": 0 }, "id": "search" }]
        """

        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(
                    sequence: 1,
                    keyboardTarget: "terminal",
                    targetPanelId: "terminal-a",
                    terminals: terminals,
                    overlays: overlays
                )
            ),
            .applied
        )

        let snapshot = try debugSnapshot(window)
        let surfaces = try XCTUnwrap(snapshot["surfaces"] as? [[String: Any]])
        let surfaceById = Dictionary(
            uniqueKeysWithValues: surfaces.compactMap { surface in
                (surface["panelId"] as? String).map { ($0, surface) }
            }
        )
        XCTAssertEqual(surfaceById["terminal-a"]?["hostKeyboardActive"] as? Bool, true)
        XCTAssertEqual(surfaceById["terminal-a"]?["isFirstResponder"] as? Bool, true)
        XCTAssertEqual(surfaceById["terminal-b"]?["hostKeyboardActive"] as? Bool, false)
        let windowState = try XCTUnwrap(snapshot["window"] as? [String: Any])
        XCTAssertEqual(windowState["terminalTargetCount"] as? Int, 2)
        XCTAssertEqual(windowState["webOverlayRectCount"] as? Int, 1)
    }

    func testDuplicateTerminalStateRepairsFirstResponderAndWebStateDeactivatesSurfaces() throws {
        let window = makeWindow(browserWindowId: 4103)
        defer { impl.detachWindow(parent: window) }
        createTerminal("terminal-a", in: window)
        let terminals = """
        [{ "focused": true, "frame": { "height": 200, "width": 300, "x": 10, "y": 20 }, "panelId": "terminal-a", "visible": true }]
        """
        let terminalState = stateJSON(
            sequence: 1,
            keyboardTarget: "terminal",
            targetPanelId: "terminal-a",
            terminals: terminals
        )
        XCTAssertEqual(impl.applyWindowState(parent: window, json: terminalState), .applied)
        _ = window.makeFirstResponder(nil)

        XCTAssertEqual(impl.applyWindowState(parent: window, json: terminalState), .unchanged)
        var snapshot = try debugSnapshot(window)
        var surfaces = try XCTUnwrap(snapshot["surfaces"] as? [[String: Any]])
        XCTAssertEqual(surfaces.first?["isFirstResponder"] as? Bool, true)

        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(
                    sequence: 2,
                    keyboardTarget: "web",
                    terminals: terminals.replacingOccurrences(of: "\"focused\": true", with: "\"focused\": false")
                )
            ),
            .applied
        )
        snapshot = try debugSnapshot(window)
        surfaces = try XCTUnwrap(snapshot["surfaces"] as? [[String: Any]])
        XCTAssertEqual(surfaces.first?["hostKeyboardActive"] as? Bool, false)
        XCTAssertEqual(surfaces.first?["isSurfaceFocused"] as? Bool, false)
    }

    func testRestoringVisibleTerminalRearmsPresentationCoverBeforeUnhide() async throws {
        let window = makeWindow(browserWindowId: 4104)
        window.orderFront(nil)
        defer { impl.detachWindow(parent: window) }
        createTerminal("terminal-a", in: window)
        let visibleTerminal = """
        [{ "focused": true, "frame": { "height": 200, "width": 300, "x": 10, "y": 20 }, "panelId": "terminal-a", "visible": true }]
        """
        let hiddenTerminal = visibleTerminal.replacingOccurrences(
            of: "\"visible\": true",
            with: "\"visible\": false"
        ).replacingOccurrences(
            of: "\"focused\": true",
            with: "\"focused\": false"
        )

        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(
                    sequence: 1,
                    keyboardTarget: "terminal",
                    targetPanelId: "terminal-a",
                    terminals: visibleTerminal
                )
            ),
            .applied
        )
        let initiallyPresented = await waitUntil {
            (try? self.presentationCovered(window)) == false
        }
        XCTAssertTrue(initiallyPresented)

        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(
                    sequence: 2,
                    keyboardTarget: "web",
                    terminals: hiddenTerminal
                )
            ),
            .applied
        )
        XCTAssertFalse(try presentationCovered(window))

        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: stateJSON(
                    sequence: 3,
                    keyboardTarget: "terminal",
                    targetPanelId: "terminal-a",
                    terminals: visibleTerminal
                )
            ),
            .applied
        )
        // prepareForVisibilityPresentation rearms the cover, then the host-resize
        // flush synchronously presents a matching IOSurface so applyWindowState
        // returns with the cover already cleared (no stuck matte).
        let restoredPresented = await waitUntil {
            (try? self.presentationCovered(window)) == false
        }
        XCTAssertTrue(restoredPresented)
    }

    private func presentationCovered(_ window: NSWindow) throws -> Bool {
        let snapshot = try debugSnapshot(window)
        let surfaces = try XCTUnwrap(snapshot["surfaces"] as? [[String: Any]])
        let surface = try XCTUnwrap(
            surfaces.first { $0["panelId"] as? String == "terminal-a" }
        )
        return try XCTUnwrap(surface["presentationCovered"] as? Bool)
    }

    private func waitUntil(
        timeout: TimeInterval = 3,
        condition: @escaping @MainActor () -> Bool
    ) async -> Bool {
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        while ProcessInfo.processInfo.systemUptime < deadline {
            if condition() {
                return true
            }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return condition()
    }
}
