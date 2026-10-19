import AppKit
import XCTest
@testable import GhosttyBridge

/// Cmd+C/V/A must reach the terminal that owns the keyboard even when the
/// Edit-menu roles are still aimed at the Chromium first responder.
final class TerminalClipboardChordTests: XCTestCase {
    func testBareCommandClipboardChordsMapToTerminalActions() {
        let command: NSEvent.ModifierFlags = [.command]

        XCTAssertEqual(
            EventRouterView.terminalClipboardAction(
                modifierFlags: command,
                chars: "c"
            ),
            .copy
        )
        XCTAssertEqual(
            EventRouterView.terminalClipboardAction(
                modifierFlags: command,
                chars: "v"
            ),
            .paste
        )
        XCTAssertEqual(
            EventRouterView.terminalClipboardAction(
                modifierFlags: command,
                chars: "a"
            ),
            .selectAll
        )
    }

    func testShiftedOrOptionedChordsKeepTheirOwnMeaning() {
        XCTAssertNil(
            EventRouterView.terminalClipboardAction(
                modifierFlags: [.command, .shift],
                chars: "C"
            )
        )
        XCTAssertNil(
            EventRouterView.terminalClipboardAction(
                modifierFlags: [.command, .option],
                chars: "c"
            )
        )
    }

    func testNonCommandChordsAreNotClipboard() {
        XCTAssertNil(
            EventRouterView.terminalClipboardAction(
                modifierFlags: [.control],
                chars: "c"
            )
        )
        XCTAssertNil(
            EventRouterView.terminalClipboardAction(
                modifierFlags: [],
                chars: "c"
            )
        )
    }

    func testActionsUseGhosttyBindingNames() {
        XCTAssertEqual(
            TerminalClipboardAction.copy.bindingAction,
            "copy_to_clipboard"
        )
        XCTAssertEqual(
            TerminalClipboardAction.paste.bindingAction,
            "paste_from_clipboard"
        )
        XCTAssertEqual(
            TerminalClipboardAction.selectAll.bindingAction,
            "select_all"
        )
    }
}
