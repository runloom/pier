@testable import GhosttyBridge
@_spi(PierDiagnostics) @testable import GhosttyTerminal
import AppKit
import XCTest

/// C：可打印键 / Enter / Backspace 回 live；裸方向键与 Page 只进 TUI，
/// 不得把宿主视口拽到底。Ctrl/Alt/Super 和弦仍走 Ghostty 默认 follow。
@MainActor
final class TerminalScrollToBottomKeystrokeTests: XCTestCase {
    func testArrowDownDoesNotJumpViewportToLive() async throws {
        let fixture = try await makePinnedFixture()
        defer { fixture.window.orderOut(nil) }
        let offsetBefore = try XCTUnwrap(fixture.probe.state).offset

        XCTAssertTrue(fixture.view.sendKeyPress(keycode: 0x7D))
        await settle()

        let after = try XCTUnwrap(fixture.probe.state)
        XCTAssertLessThan(
            after.offset + after.length,
            after.total,
            "Arrow Down must stay in scrollback; follow yanked \(offsetBefore) → \(after.offset) / \(after.total)"
        )
        XCTAssertLessThanOrEqual(
            after.offset,
            offsetBefore + 2,
            "Arrow Down must not jump toward live. before=\(offsetBefore) after=\(after.offset)"
        )
    }

    func testTypedCharacterJumpsViewportToLive() async throws {
        let fixture = try await makePinnedFixture()
        defer { fixture.window.orderOut(nil) }
        let before = try XCTUnwrap(fixture.probe.state)
        XCTAssertLessThan(before.offset + before.length, before.total)

        XCTAssertTrue(fixture.view.sendKeyPress(keycode: 0x00, text: "a"))
        let jumped = await waitUntil {
            guard let state = fixture.probe.state else { return false }
            return state.offset + state.length >= state.total
        }
        XCTAssertTrue(
            jumped,
            "Typing must snap back to live so the prompt stays visible. last=\(String(describing: fixture.probe.state))"
        )
    }

    private struct Fixture {
        let probe: ScrollbarProbe
        let view: TerminalView
        let window: NSWindow
    }

    private func makePinnedFixture() async throws -> Fixture {
        let probe = ScrollbarProbe()
        let controller = TerminalController(
            configuration: TerminalConfiguration {
                GhosttyBridgeImpl.configureDefaultTerminalAppearance(&$0)
                $0.withCursorStyleBlink(false)
            }
        )
        let issue = controller.lastConfigurationIssue
        XCTAssertNil(issue, "appearance config rejected: \(issue ?? "")")

        let session = InMemoryTerminalSession(write: { _ in }, resize: { _ in })
        let view = TerminalView(frame: .zero)
        view.delegate = probe
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        view.controller = controller
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 400),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        view.frame = NSRect(x: 0, y: 0, width: 640, height: 400)
        try XCTUnwrap(window.contentView).addSubview(view)
        await settle()

        for index in 0..<400 {
            session.receive("pier-scroll-line-\(index)\n")
        }
        let filled = await waitUntil {
            guard let state = probe.state else { return false }
            return state.total > state.length && state.length > 0
        }
        XCTAssertTrue(filled, "expected scrollback taller than the viewport")

        let filledState = try XCTUnwrap(probe.state)
        let maxOffset = filledState.total - filledState.length
        let pinnedOffset = max(UInt64(8), maxOffset / 3)
        XCTAssertTrue(view.performBindingAction("scroll_to_row:\(pinnedOffset)"))

        let pinned = await waitUntil {
            guard let state = probe.state else { return false }
            return state.offset <= pinnedOffset + 2 && state.offset + state.length < state.total
        }
        XCTAssertTrue(pinned, "expected viewport pinned away from live")
        return Fixture(probe: probe, view: view, window: window)
    }

    private func settle() async {
        for _ in 0..<5 {
            await withCheckedContinuation { continuation in
                DispatchQueue.main.async { continuation.resume() }
            }
            try? await Task.sleep(for: .milliseconds(40))
        }
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

@MainActor
private final class ScrollbarProbe: TerminalSurfaceScrollbarDelegate {
    var state: TerminalScrollbarState?

    func terminalDidUpdateScrollbar(_ state: TerminalScrollbarState) {
        self.state = state
    }
}
