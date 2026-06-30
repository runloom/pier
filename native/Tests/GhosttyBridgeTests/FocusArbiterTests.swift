@testable import GhosttyBridge
import XCTest

final class FocusArbiterTests: XCTestCase {
    func testEmptyWebRequestsFollowsBasePanel() {
        var state = GhosttyBridgeImpl.WindowKeyboardState()
        state.basePanel = .terminal("terminal-1")
        XCTAssertEqual(state.effectiveTarget, .terminal("terminal-1"))
    }

    func testAnyWebRequestForcesWeb() {
        var state = GhosttyBridgeImpl.WindowKeyboardState()
        state.basePanel = .terminal("terminal-1")
        state.webRequests = ["search:terminal-1"]
        XCTAssertEqual(state.effectiveTarget, .web)
    }

    func testReleasingLastWebRequestRestoresBasePanel() {
        var state = GhosttyBridgeImpl.WindowKeyboardState()
        state.basePanel = .terminal("terminal-1")
        state.webRequests = ["search:terminal-1"]
        state.webRequests.removeAll { $0 == "search:terminal-1" }
        XCTAssertEqual(state.effectiveTarget, .terminal("terminal-1"))
    }

    func testMultipleWebRequestsStayWebUntilAllReleased() {
        var state = GhosttyBridgeImpl.WindowKeyboardState()
        state.basePanel = .terminal("terminal-1")
        state.webRequests = ["a", "b"]
        state.webRequests.removeAll { $0 == "a" }
        XCTAssertEqual(state.effectiveTarget, .web)
        state.webRequests.removeAll { $0 == "b" }
        XCTAssertEqual(state.effectiveTarget, .terminal("terminal-1"))
    }

    func testAcceptsTerminalKeyboardRequiresWindowFocusAndTerminalTarget() {
        var state = GhosttyBridgeImpl.WindowKeyboardState()
        state.basePanel = .terminal("terminal-1")
        state.windowFocused = false
        XCTAssertFalse(state.acceptsTerminalKeyboard)
        state.windowFocused = true
        XCTAssertTrue(state.acceptsTerminalKeyboard)
        state.webRequests = ["x"]
        XCTAssertFalse(state.acceptsTerminalKeyboard)
    }

    @MainActor
    func testNativeTerminalFocusIntentClearsWebRequests() {
        let window = NSWindow()
        let impl = GhosttyBridgeImpl.shared
        impl.applyInputRouting(
            parent: window,
            json: """
            {
              "basePanel": { "kind": "terminal", "panelId": "terminal-1" },
              "nativeApplySequence": 1,
              "rendererSequence": 1,
              "webOverlayRects": [],
              "webRequestCount": 1,
              "windowFocused": true
            }
            """
        )
        XCTAssertEqual(impl.stateFor(window: window).effectiveTarget, .web)

        impl.activateTerminalFocus(parent: window, panelId: "terminal-1")

        let state = impl.stateFor(window: window)
        XCTAssertEqual(state.basePanel, .terminal("terminal-1"))
        XCTAssertTrue(state.webRequests.isEmpty)
        XCTAssertEqual(state.effectiveTarget, .terminal("terminal-1"))
    }
}
