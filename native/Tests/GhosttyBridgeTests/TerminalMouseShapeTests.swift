import AppKit
import GhosttyKit
import XCTest
@testable import GhosttyTerminal

/// Verifies the GHOSTTY_ACTION_MOUSE_SHAPE / MOUSE_VISIBILITY actions reach
/// the coordinator hooks so the AppKit view can swap the cursor (pointer hand
/// on link hover) and honor pointer visibility.
@MainActor
final class TerminalMouseShapeTests: XCTestCase {
    private func actionWithShape(
        _ shape: ghostty_action_mouse_shape_e
    ) -> ghostty_action_s {
        var action = ghostty_action_s()
        action.tag = GHOSTTY_ACTION_MOUSE_SHAPE
        action.action.mouse_shape = shape
        return action
    }

    private func actionWithVisibility(
        _ visible: ghostty_action_mouse_visibility_e
    ) -> ghostty_action_s {
        var action = ghostty_action_s()
        action.tag = GHOSTTY_ACTION_MOUSE_VISIBILITY
        action.action.mouse_visibility = visible
        return action
    }

    func testBridgeDispatchesMouseShapeActionToHook() {
        let bridge = TerminalCallbackBridge(delegate: nil)
        var shapes: [TerminalMouseShape] = []
        bridge.onMouseShape = { shapes.append($0) }

        bridge.handleAction(actionWithShape(GHOSTTY_MOUSE_SHAPE_POINTER))
        bridge.handleAction(actionWithShape(GHOSTTY_MOUSE_SHAPE_TEXT))

        XCTAssertEqual(shapes, [.pointer, .text])
    }

    func testBridgeDispatchesMouseVisibilityActionToHook() {
        let bridge = TerminalCallbackBridge(delegate: nil)
        var visibility: [Bool] = []
        bridge.onMouseVisibility = { visibility.append($0) }

        bridge.handleAction(actionWithVisibility(GHOSTTY_MOUSE_HIDDEN))
        bridge.handleAction(actionWithVisibility(GHOSTTY_MOUSE_VISIBLE))

        XCTAssertEqual(visibility, [false, true])
    }

    func testBridgeWithoutMouseHooksIsNoop() {
        let bridge = TerminalCallbackBridge(delegate: nil)
        bridge.handleAction(actionWithShape(GHOSTTY_MOUSE_SHAPE_POINTER))
        bridge.handleAction(actionWithVisibility(GHOSTTY_MOUSE_HIDDEN))
    }

    func testShapeEnumMapping() {
        XCTAssertEqual(
            TerminalMouseShape(GHOSTTY_MOUSE_SHAPE_DEFAULT),
            .arrow
        )
        XCTAssertEqual(
            TerminalMouseShape(GHOSTTY_MOUSE_SHAPE_POINTER),
            .pointer
        )
        XCTAssertEqual(
            TerminalMouseShape(GHOSTTY_MOUSE_SHAPE_GRABBING),
            .grabbing
        )
        XCTAssertEqual(
            TerminalMouseShape(GHOSTTY_MOUSE_SHAPE_ZOOM_IN),
            .unknown
        )
    }
}
