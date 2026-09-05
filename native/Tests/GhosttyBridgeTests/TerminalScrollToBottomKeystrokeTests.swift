@testable import GhosttyBridge
@_spi(PierDiagnostics) @testable import GhosttyTerminal
import AppKit
import GhosttyKit
import os
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

    func testScrollToBottomActionIsRepeatableWithoutSendingTuiInput() async throws {
        let fixture = try await makePinnedFixture()
        defer { fixture.window.orderOut(nil) }
        let before = try XCTUnwrap(fixture.probe.state)
        fixture.input.withLock { $0.removeAll() }

        XCTAssertTrue(fixture.view.performBindingAction("scroll_to_bottom"))
        let jumped = await waitUntil { fixture.isAtBottom }
        XCTAssertTrue(jumped, "the explicit action must leave scrollback")
        XCTAssertTrue(fixture.session.readViewportText()?.contains("pier-scroll-line-399") == true)

        XCTAssertTrue(fixture.view.performBindingAction("scroll_to_bottom"))
        await settle()
        XCTAssertTrue(fixture.isAtBottom)
        XCTAssertEqual(try XCTUnwrap(fixture.probe.state).total, before.total)
        XCTAssertTrue(fixture.input.withLock { $0.isEmpty }, "viewport actions must not send End to the TUI")
    }

    func testNewOutputPreservesReviewPositionUntilExplicitlyReturningToBottom() async throws {
        let fixture = try await makePinnedFixture()
        defer { fixture.window.orderOut(nil) }
        let before = try XCTUnwrap(fixture.probe.state)
        let reviewedText = try XCTUnwrap(fixture.session.readViewportText())

        fixture.session.receive("pier-output-while-reviewing\r\n")
        let outputReceived = await waitUntil {
            guard let state = fixture.probe.state else { return false }
            return state.total > before.total
        }
        XCTAssertTrue(outputReceived)
        XCTAssertEqual(try XCTUnwrap(fixture.probe.state).offset, before.offset)
        XCTAssertEqual(fixture.session.readViewportText(), reviewedText)
        XCTAssertFalse(fixture.isAtBottom)

        XCTAssertTrue(fixture.view.performBindingAction("scroll_to_bottom"))
        let jumped = await waitUntil { fixture.isAtBottom }
        XCTAssertTrue(jumped)
        let liveTotal = try XCTUnwrap(fixture.probe.state).total
        fixture.session.receive("pier-output-after-returning\r\n")
        let followed = await waitUntil {
            guard let state = fixture.probe.state else { return false }
            return state.total > liveTotal && fixture.isAtBottom
        }
        XCTAssertTrue(followed, "output must remain visible after returning to live")
        XCTAssertTrue(fixture.session.readViewportText()?.contains("pier-output-after-returning") == true)
    }

    func testNativeCommandEndReturnsToBottomWithoutSendingTuiInput() async throws {
        let fixture = try await makePinnedFixture()
        defer { fixture.window.orderOut(nil) }
        fixture.input.withLock { $0.removeAll() }

        XCTAssertTrue(fixture.view.sendKeyPress(keycode: 0x77, mods: GHOSTTY_MODS_SUPER.rawValue))
        let jumped = await waitUntil { fixture.isAtBottom }
        XCTAssertTrue(jumped, "Ghostty's default Cmd+End must retain viewport ownership")
        await settle()
        XCTAssertTrue(fixture.input.withLock { $0.isEmpty })
    }

    func testNativeCommandDownReturnsToBottomWithoutPromptMarkersOrTuiInput() async throws {
        let fixture = try await makePinnedFixture()
        defer { fixture.window.orderOut(nil) }
        fixture.input.withLock { $0.removeAll() }

        // TUI transcript lines need not contain the OSC 133 shell prompt markers
        // required by Ghostty's default jump_to_prompt action.
        XCTAssertTrue(fixture.view.sendKeyPress(keycode: 0x7D, mods: GHOSTTY_MODS_SUPER.rawValue))
        let jumped = await waitUntil { fixture.isAtBottom }
        XCTAssertTrue(jumped, "Cmd+Down must return to the latest TUI output without shell prompt markers")
        XCTAssertTrue(fixture.session.readViewportText()?.contains("pier-scroll-line-399") == true)
        await settle()
        XCTAssertTrue(fixture.input.withLock { $0.isEmpty }, "viewport navigation must not send a key to the TUI")
    }

    func testAppKitCommandDownEquivalentReturnsToBottom() async throws {
        let fixture = try await makePinnedFixture()
        defer { fixture.window.orderOut(nil) }
        fixture.view.hostKeyboardActive = true
        XCTAssertTrue(fixture.window.makeFirstResponder(fixture.view))
        fixture.input.withLock { $0.removeAll() }
        let event = try XCTUnwrap(NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [.command, .function, .numericPad],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: fixture.window.windowNumber,
            context: nil,
            characters: "\u{F701}",
            charactersIgnoringModifiers: "\u{F701}",
            isARepeat: false,
            keyCode: 0x7D
        ))

        XCTAssertTrue(fixture.view.performKeyEquivalent(with: event))
        let jumped = await waitUntil { fixture.isAtBottom }
        XCTAssertTrue(jumped, "AppKit Cmd+Down must reach the same native viewport action")
        XCTAssertTrue(fixture.session.readViewportText()?.contains("pier-scroll-line-399") == true)
        await settle()
        XCTAssertTrue(fixture.input.withLock { $0.isEmpty })
    }

    func testScrollToBottomIsHarmlessWithEmptyOrShortHistory() async throws {
        for lineCount in [0, 3] {
            let fixture = try await makeFixture(lineCount: lineCount)
            defer { fixture.window.orderOut(nil) }
            let before = try XCTUnwrap(fixture.probe.state)
            let textBefore = fixture.session.readViewportText()
            XCTAssertTrue(fixture.isAtBottom)

            XCTAssertTrue(fixture.view.performBindingAction("scroll_to_bottom"))
            XCTAssertTrue(fixture.view.performBindingAction("scroll_to_bottom"))
            await settle()

            XCTAssertTrue(fixture.isAtBottom)
            XCTAssertEqual(try XCTUnwrap(fixture.probe.state).total, before.total)
            XCTAssertEqual(fixture.session.readViewportText(), textBefore)
            XCTAssertTrue(fixture.input.withLock { $0.isEmpty })
        }
    }

    @MainActor
    private struct Fixture {
        let input: OSAllocatedUnfairLock<Data>
        let probe: ScrollbarProbe
        let session: InMemoryTerminalSession
        let view: TerminalView
        let window: NSWindow

        var isAtBottom: Bool {
            guard let state = probe.state else { return false }
            return state.length > 0 && state.offset + state.length >= state.total
        }
    }

    private func makePinnedFixture() async throws -> Fixture {
        let fixture = try await makeFixture(lineCount: 400)
        let filledState = try XCTUnwrap(fixture.probe.state)
        let maxOffset = filledState.total - filledState.length
        let pinnedOffset = max(UInt64(8), maxOffset / 3)
        XCTAssertTrue(fixture.view.performBindingAction("scroll_to_row:\(pinnedOffset)"))

        let pinned = await waitUntil {
            guard let state = fixture.probe.state else { return false }
            return state.offset <= pinnedOffset + 2 && state.offset + state.length < state.total
        }
        XCTAssertTrue(pinned, "expected viewport pinned away from live")
        return fixture
    }

    private func makeFixture(lineCount: Int) async throws -> Fixture {
        let input = OSAllocatedUnfairLock(initialState: Data())
        let probe = ScrollbarProbe()
        let controller = TerminalController(
            configuration: TerminalConfiguration {
                GhosttyBridgeImpl.configureDefaultTerminalAppearance(&$0)
                $0.withCursorStyleBlink(false)
            }
        )
        let issue = controller.lastConfigurationIssue
        XCTAssertNil(issue, "appearance config rejected: \(issue ?? "")")

        let session = InMemoryTerminalSession(
            write: { data in input.withLock { $0.append(data) } },
            resize: { _ in }
        )
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

        for index in 0..<lineCount {
            session.receive("pier-scroll-line-\(index)\r\n")
        }
        let filled = await waitUntil {
            guard let state = probe.state else { return false }
            return state.total >= UInt64(lineCount) && state.length > 0
        }
        XCTAssertTrue(filled, "expected the output to reach the terminal")
        return Fixture(input: input, probe: probe, session: session, view: view, window: window)
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
