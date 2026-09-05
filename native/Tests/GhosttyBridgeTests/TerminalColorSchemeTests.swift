@testable import GhosttyTerminal
import AppKit
import GhosttyKit
import os
import XCTest

@MainActor
final class TerminalColorSchemeTests: XCTestCase {
    func testAppearanceChangeUpdatesReportsWithAnUnchangedPalette() async throws {
        let terminal = try makeTerminal(scheme: .light)
        defer { terminal.window.orderOut(nil) }
        terminal.session.receive("\u{1b}[?2031h\u{1b}[?996n")
        let initial = await waitUntil { terminal.text.contains("\u{1b}[?997;2n") }
        XCTAssertTrue(initial)

        for (appearance, report) in [
            (NSAppearance.Name.darkAqua, "\u{1b}[?997;1n"),
            (NSAppearance.Name.aqua, "\u{1b}[?997;2n"),
        ] {
            terminal.output.withLock { $0.removeAll() }
            terminal.window.appearance = NSAppearance(named: appearance)
            // Some test runners do not display windows; explicitly exercise the
            // same AppKit callback to avoid depending on a compositor frame.
            terminal.view.viewDidChangeEffectiveAppearance()
            let received = await waitUntil { terminal.text.contains(report) }
            XCTAssertTrue(
                received,
                "Expected \(report.debugDescription), received \(terminal.text.debugDescription)"
            )
        }
    }

    func testNewTerminalReportsInitialDarkSchemeWithALightPalette() async throws {
        let terminal = try makeTerminal(scheme: .dark)
        defer { terminal.window.orderOut(nil) }
        terminal.session.receive("\u{1b}[?996n")
        let received = await waitUntil { terminal.text.contains("\u{1b}[?997;1n") }
        XCTAssertTrue(received, "Received \(terminal.text.debugDescription)")
        XCTAssertFalse(terminal.text.contains("\u{1b}[?997;2n"))
    }

    func testAppSoftReloadUpdatesExistingSurfaceButHardReloadIsUnhandled() throws {
        let terminal = try makeTerminal(scheme: .light)
        defer { terminal.window.orderOut(nil) }
        let bridge = try XCTUnwrap(terminal.controller.retainedBridges.first)
        var refreshCount = 0
        bridge.onRefreshRequest = { refreshCount += 1 }
        var target = ghostty_target_s()
        target.tag = GHOSTTY_TARGET_APP
        var action = ghostty_action_s()
        action.tag = GHOSTTY_ACTION_RELOAD_CONFIG
        action.action.reload_config.soft = true

        XCTAssertTrue(TerminalCallbacks.action(
            appPtr: terminal.controller.app, target: target, action: action
        ))
        // A consumed callback must actually apply config to existing surfaces
        // synchronously, not merely return true or queue a later host reload.
        XCTAssertGreaterThan(refreshCount, 0)

        refreshCount = 0
        action.action.reload_config.soft = false
        XCTAssertFalse(TerminalCallbacks.action(
            appPtr: terminal.controller.app, target: target, action: action
        ))
        XCTAssertEqual(refreshCount, 0)
    }

    private func makeTerminal(scheme: TerminalColorScheme) throws -> TestTerminal {
        let output = OSAllocatedUnfairLock(initialState: Data())
        let colors = TerminalConfiguration { builder in
            builder.withBackground("#ffffff")
            builder.withForeground("#0a0a0a")
        }
        // Pier supplies resolved colors in both variants. Changing the scheme
        // must still reload Ghostty's conditional state when the config is equal.
        let controller = TerminalController(theme: TerminalTheme(light: colors, dark: colors))
        controller.setColorScheme(scheme)
        let session = InMemoryTerminalSession(
            write: { data in output.withLock { $0.append(data) } },
            resize: { _ in }
        )
        let view = TerminalView(frame: NSRect(x: 0, y: 0, width: 640, height: 400))
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        view.controller = controller
        let window = NSWindow(
            contentRect: view.frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
        try XCTUnwrap(window.contentView).addSubview(view)
        return TestTerminal(
            controller: controller, session: session, view: view, window: window, output: output
        )
    }

    private func waitUntil(condition: @escaping @MainActor () -> Bool) async -> Bool {
        let deadline = ProcessInfo.processInfo.systemUptime + 2
        while ProcessInfo.processInfo.systemUptime < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return condition()
    }

    private struct TestTerminal {
        let controller: TerminalController
        let session: InMemoryTerminalSession
        let view: TerminalView
        let window: NSWindow
        let output: OSAllocatedUnfairLock<Data>

        var text: String {
            output.withLock { String(decoding: $0, as: UTF8.self) }
        }
    }
}
