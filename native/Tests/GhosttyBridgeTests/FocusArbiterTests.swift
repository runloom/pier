@testable import GhosttyBridge
import XCTest

final class FocusArbiterTests: XCTestCase {
    func testEmptyWebRequestsFollowsBasePanel() {
        var s = GhosttyBridgeImpl.WindowKeyboardState()
        s.basePanel = .terminal("terminal-1")
        XCTAssertEqual(s.effectiveTarget, .terminal("terminal-1"))
    }

    func testAnyWebRequestForcesWeb() {
        var s = GhosttyBridgeImpl.WindowKeyboardState()
        s.basePanel = .terminal("terminal-1")
        s.webRequests = ["search:terminal-1"]
        XCTAssertEqual(s.effectiveTarget, .web)
    }

    func testReleasingLastWebRequestRestoresBasePanel() {
        var s = GhosttyBridgeImpl.WindowKeyboardState()
        s.basePanel = .terminal("terminal-1")
        s.webRequests = ["search:terminal-1"]
        s.webRequests.removeAll { $0 == "search:terminal-1" }
        XCTAssertEqual(s.effectiveTarget, .terminal("terminal-1"))
    }

    func testAcceptsTerminalKeyboardRequiresWindowFocusAndTerminalTarget() {
        var s = GhosttyBridgeImpl.WindowKeyboardState()
        s.basePanel = .terminal("terminal-1")
        s.windowFocused = false
        XCTAssertFalse(s.acceptsTerminalKeyboard)
        s.windowFocused = true
        XCTAssertTrue(s.acceptsTerminalKeyboard)
        s.webRequests = ["x"]
        XCTAssertFalse(s.acceptsTerminalKeyboard)
    }
}
