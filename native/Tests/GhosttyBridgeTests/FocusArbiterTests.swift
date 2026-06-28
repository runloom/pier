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
}

@MainActor
final class FocusArbiterIntentTests: XCTestCase {
    func testRequestAndReleaseWebFocusTogglesEffectiveTarget() {
        let impl = GhosttyBridgeImpl.shared
        let win = NSWindow()
        impl.setBasePanel(window: win, target: .terminal("terminal-1"))
        XCTAssertEqual(impl.stateFor(window: win).effectiveTarget, .terminal("terminal-1"))

        impl.requestWebFocus(window: win, id: "search:terminal-1")
        XCTAssertEqual(impl.stateFor(window: win).effectiveTarget, .web)

        impl.releaseWebFocus(window: win, id: "search:terminal-1")
        XCTAssertEqual(impl.stateFor(window: win).effectiveTarget, .terminal("terminal-1"))
    }

    func testDuplicateRequestIsIdempotent() {
        let impl = GhosttyBridgeImpl.shared
        let win = NSWindow()
        impl.requestWebFocus(window: win, id: "a")
        impl.requestWebFocus(window: win, id: "a")
        impl.releaseWebFocus(window: win, id: "a")
        XCTAssertTrue(impl.stateFor(window: win).webRequests.isEmpty)
    }
}
