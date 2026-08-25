import AppKit
import Darwin
import GhosttyKit
import XCTest
@testable import GhosttyTerminal

/// Verifies ghostty core link detection across row wraps:
/// - A URL soft-wrapped by the terminal itself (row.wrap set) is detected as
///   one logical line: hover + cmd-click expose the FULL url.
/// - A URL hard-split by the emitting program (explicit newline, e.g. ink/TUI
///   reflow) produces two independent rows: detection stops at the row edge,
///   so only the first row's text is the link. This is the expected core
///   behavior; Pier cannot recover the continuation.
@MainActor
final class TerminalLinkWrapDetectionTests: XCTestCase {
    final class LinkCapture: TerminalSurfaceHoverLinkDelegate,
        TerminalSurfaceOpenURLDelegate
    {
        var hoverUrls: [String?] = []
        var openedUrls: [String] = []
        func terminalDidUpdateHoverLink(_ url: String?) {
            hoverUrls.append(url)
        }
        func terminalDidRequestOpenURL(_ url: String, kind: TerminalOpenURLKind) {
            openedUrls.append(url)
        }
    }

    private struct Fixture {
        let session: InMemoryTerminalSession
        let view: TerminalView
        let window: NSWindow
    }

    private var capture = LinkCapture()

    private func makeFixture(size: NSSize) throws -> Fixture {
        let controller = TerminalController { builder in
            builder.withCursorStyleBlink(false)
        }
        let session = InMemoryTerminalSession(write: { _ in }, resize: { _ in })
        let view = TerminalView(frame: .zero)
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        view.controller = controller
        view.delegate = capture
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        view.frame = NSRect(origin: .zero, size: size)
        try XCTUnwrap(window.contentView).addSubview(view)
        return Fixture(session: session, view: view, window: window)
    }

    private func settleRendering() async {
        for _ in 0..<5 {
            await drainMainQueue()
            try? await Task.sleep(for: .milliseconds(50))
        }
    }

    private func drainMainQueue() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.main.async {
                continuation.resume()
            }
        }
    }

    private func waitUntil(
        timeout: TimeInterval = 5,
        _ body: () -> Bool
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if body() { return true }
            await drainMainQueue()
            try? await Task.sleep(for: .milliseconds(20))
        }
        return body()
    }

    private func hoverOverCell(
        _ fixture: Fixture,
        column: Int,
        row: Int
    ) {
        let metrics = try! XCTUnwrap(fixture.view.surface?.size())
        let scale = fixture.window.screen?.backingScaleFactor
            ?? NSScreen.main?.backingScaleFactor ?? 2
        let cellWidth = CGFloat(metrics.cellWidthPixels) / scale
        let cellHeight = CGFloat(metrics.cellHeightPixels) / scale
        let mods = TerminalInputModifiers.super_
        fixture.view.surface?.sendMousePos(
            x: CGFloat(column) * cellWidth + 1,
            y: CGFloat(row) * cellHeight + cellHeight / 2,
            mods: mods.ghosttyMods
        )
    }

    private func cmdClickCell(
        _ fixture: Fixture,
        column: Int,
        row: Int
    ) {
        hoverOverCell(fixture, column: column, row: row)
        let mods = TerminalInputModifiers.super_.ghosttyMods
        fixture.view.surface?.sendMouseButton(
            state: GHOSTTY_MOUSE_PRESS,
            button: GHOSTTY_MOUSE_LEFT,
            mods: mods
        )
        fixture.view.surface?.sendMouseButton(
            state: GHOSTTY_MOUSE_RELEASE,
            button: GHOSTTY_MOUSE_LEFT,
            mods: mods
        )
    }

    private func lastHoverUrl(_ fixture: Fixture) async -> String? {
        _ = await waitUntil {
            !self.capture.hoverUrls.isEmpty && self.capture.hoverUrls.last != nil
                && self.capture.hoverUrls.last != ""
        }
        return capture.hoverUrls.last ?? nil
    }

    func testSoftWrappedUrlIsDetectedAcrossRows() async throws {
        let fixture = try makeFixture(size: NSSize(width: 640, height: 400))
        await settleRendering()
        let metrics = try XCTUnwrap(fixture.view.surface?.size())
        let cols = Int(metrics.columns)
        let url = "http://" + String(repeating: "a", count: max(cols * 2, 40))

        fixture.session.receive(url + "\n")
        let painted = await waitUntil {
            fixture.session.readViewportText()?.contains("http://") == true
        }
        XCTAssertTrue(painted)
        await settleRendering()

        capture.hoverUrls.removeAll()
        capture.openedUrls.removeAll()

        hoverOverCell(fixture, column: 3, row: 0)
        let hovered = await lastHoverUrl(fixture)
        XCTAssertEqual(hovered, url, "hover must expose the full soft-wrapped url")

        cmdClickCell(fixture, column: 3, row: 0)
        let clicked = await waitUntil { !self.capture.openedUrls.isEmpty }
        XCTAssertTrue(clicked, "cmd-click must fire open_url")
        XCTAssertEqual(capture.openedUrls.last, url, "click must open the full url")
    }

    func testProgramHardWrappedUrlStopsAtRowEdge() async throws {
        let fixture = try makeFixture(size: NSSize(width: 640, height: 400))
        await settleRendering()
        let metrics = try XCTUnwrap(fixture.view.surface?.size())
        let cols = Int(metrics.columns)
        let head = String(
            ("http://" + String(repeating: "a", count: cols * 2)).prefix(cols)
        )
        let tail = "434/v1-and-more"

        fixture.session.receive(head + "\n" + tail + "\n")
        let painted = await waitUntil {
            fixture.session.readViewportText()?.contains(tail) == true
        }
        XCTAssertTrue(painted)
        await settleRendering()

        capture.hoverUrls.removeAll()
        capture.openedUrls.removeAll()

        hoverOverCell(fixture, column: 3, row: 0)
        let hovered = await lastHoverUrl(fixture)
        XCTAssertEqual(
            hovered,
            head,
            "program-wrapped rows are independent lines; link stops at the row edge"
        )

        cmdClickCell(fixture, column: 3, row: 0)
        let clicked = await waitUntil { !self.capture.openedUrls.isEmpty }
        XCTAssertTrue(clicked)
        XCTAssertEqual(capture.openedUrls.last, head)
    }
}
