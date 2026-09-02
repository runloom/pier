import AppKit
import GhosttyKit
import XCTest
@testable import GhosttyTerminal

/// Ghostty clipboard kinds must stay routed: only the standard clipboard
/// resolves to the system pasteboard; selection (copy-on-select,
/// middle-click paste, OSC 52 "s") stays on a private named pasteboard so
/// incidental selections never clobber the user's clipboard. Unknown kinds
/// (zig-side `primary = 2`, OSC 52 "p") fail closed. Behavioral tests below
/// drive the real `TerminalCallbacks.writeClipboard` with fabricated C
/// payloads and assert the system pasteboard is never touched.
final class TerminalClipboardRoutingTests: XCTestCase {
    /// zig `apprt.Clipboard.primary` — not named in the C header, arrives raw.
    private static let primaryRawKind = ghostty_clipboard_e(rawValue: 2)

    private func callWriteClipboard(
        kind: ghostty_clipboard_e,
        payload: String,
        confirm: Bool = false
    ) {
        payload.withCString { payloadPtr in
            "text/plain".withCString { mimePtr in
                var content = ghostty_clipboard_content_s()
                content.mime = mimePtr
                content.data = payloadPtr
                withUnsafePointer(to: &content) { contentsPtr in
                    TerminalCallbacks.writeClipboard(
                        userdata: nil,
                        clipboard: kind,
                        contents: contentsPtr,
                        contentsLen: 1,
                        confirm: confirm
                    )
                }
            }
        }
    }

    func testKindMapsFromGhosttyEnum() {
        XCTAssertEqual(
            TerminalClipboardKind(GHOSTTY_CLIPBOARD_STANDARD),
            .standard
        )
        XCTAssertEqual(
            TerminalClipboardKind(GHOSTTY_CLIPBOARD_SELECTION),
            .selection
        )
    }

    func testUnknownKindFailsClosed() {
        XCTAssertNil(TerminalClipboardKind(Self.primaryRawKind))
        XCTAssertNil(TerminalClipboardKind(ghostty_clipboard_e(rawValue: 99)))
    }

    func testStandardKindResolvesToGeneralPasteboard() {
        XCTAssertEqual(
            NSPasteboard.pierTerminal(for: .standard).name,
            NSPasteboard.general.name
        )
    }

    func testSelectionKindResolvesToPrivatePasteboard() {
        let pasteboard = NSPasteboard.pierTerminal(for: .selection)
        XCTAssertEqual(
            pasteboard.name.rawValue,
            "io.pier.app.terminal.selection"
        )
        XCTAssertNotEqual(pasteboard.name, NSPasteboard.general.name)
    }

    func testEmptyWritePolicyIsStandardOnly() {
        XCTAssertFalse(TerminalClipboardWritePolicy.shouldWrite("", to: .standard))
        XCTAssertTrue(TerminalClipboardWritePolicy.shouldWrite(" ", to: .standard))
        XCTAssertTrue(TerminalClipboardWritePolicy.shouldWrite("\n", to: .standard))
        XCTAssertTrue(TerminalClipboardWritePolicy.shouldWrite("pier", to: .standard))
        // 私有 selection 板接受空写：空白选区要能清掉陈旧的中键粘贴内容。
        XCTAssertTrue(TerminalClipboardWritePolicy.shouldWrite("", to: .selection))
    }

    func testSelectionWriteLeavesGeneralPasteboardUntouched() {
        let generalChangeCount = NSPasteboard.general.changeCount

        callWriteClipboard(
            kind: GHOSTTY_CLIPBOARD_SELECTION,
            payload: "pier-selection-probe"
        )

        XCTAssertEqual(
            NSPasteboard.pierTerminalSelection.string(forType: .string),
            "pier-selection-probe"
        )
        XCTAssertEqual(NSPasteboard.general.changeCount, generalChangeCount)
    }

    func testEmptySelectionWriteClearsStaleSelection() {
        let selection = NSPasteboard.pierTerminalSelection
        selection.clearContents()
        selection.setString("stale-selection", forType: .string)
        let generalChangeCount = NSPasteboard.general.changeCount

        callWriteClipboard(kind: GHOSTTY_CLIPBOARD_SELECTION, payload: "")

        // 空写清陈旧选区（读侧把 "" 视为无内容 → 中键不再贴旧文本）。
        XCTAssertEqual(
            NSPasteboard.pierTerminalSelection.string(forType: .string) ?? "",
            ""
        )
        XCTAssertEqual(NSPasteboard.general.changeCount, generalChangeCount)
    }

    func testUnknownKindWriteTouchesNoPasteboard() {
        let generalChangeCount = NSPasteboard.general.changeCount
        let selectionChangeCount = NSPasteboard.pierTerminalSelection.changeCount

        callWriteClipboard(kind: Self.primaryRawKind, payload: "primary-probe")

        XCTAssertEqual(NSPasteboard.general.changeCount, generalChangeCount)
        XCTAssertEqual(
            NSPasteboard.pierTerminalSelection.changeCount,
            selectionChangeCount
        )
    }

    func testConfirmRequiredWriteIsDenied() {
        let generalChangeCount = NSPasteboard.general.changeCount

        callWriteClipboard(
            kind: GHOSTTY_CLIPBOARD_STANDARD,
            payload: "confirm-probe",
            confirm: true
        )

        XCTAssertEqual(NSPasteboard.general.changeCount, generalChangeCount)
    }

    func testEmptyStandardWriteIsSkipped() {
        let generalChangeCount = NSPasteboard.general.changeCount

        callWriteClipboard(kind: GHOSTTY_CLIPBOARD_STANDARD, payload: "")

        XCTAssertEqual(NSPasteboard.general.changeCount, generalChangeCount)
    }
}
