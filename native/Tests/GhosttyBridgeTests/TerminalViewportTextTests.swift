@_spi(PierDiagnostics) @testable import GhosttyTerminal
import AppKit
import Darwin
import XCTest

@MainActor
final class TerminalViewportTextTests: XCTestCase {
    func testRepeatedViewportReadsHitCacheWithoutRedumping() async throws {
        let fixture = try makeFixture()
        defer { fixture.window.orderOut(nil) }
        await settleRendering()
        fixture.session.receive("pier-viewport-cache\n")
        let painted = await waitUntil {
            fixture.session.readViewportText()?.contains("pier-viewport-cache") == true
        }
        XCTAssertTrue(painted)
        await settleRendering()

        let dumpsAfterPaint = fixture.session.viewportTextDumpCount
        XCTAssertGreaterThanOrEqual(dumpsAfterPaint, 1)
        for _ in 0..<200 {
            XCTAssertTrue(
                fixture.session.readViewportText()?.contains("pier-viewport-cache") == true
            )
        }
        XCTAssertEqual(fixture.session.viewportTextDumpCount, dumpsAfterPaint)
        XCTAssertGreaterThanOrEqual(fixture.session.viewportTextHitCount, 200)
    }

    func testOccludedSurfaceDumpsFreshViewportInsteadOfCachedFrame() async throws {
        let fixture = try makeFixture()
        defer { fixture.window.orderOut(nil) }
        await settleRendering()
        fixture.session.receive("pier-before-hide\n")
        let painted = await waitUntil {
            fixture.view.readViewportText()?.contains("pier-before-hide") == true
        }
        XCTAssertTrue(painted)
        let surface = try XCTUnwrap(fixture.view.surface)
        let dumpsWhileVisible = surface.viewportTextDumpCount

        fixture.view.setSurfaceVisible(false)
        fixture.session.receive("pier-after-hide\n")
        let dumpedWhileHidden = await waitUntil {
            fixture.view.readViewportText()?.contains("pier-after-hide") == true
        }
        XCTAssertTrue(dumpedWhileHidden)
        XCTAssertGreaterThan(surface.viewportTextDumpCount, dumpsWhileVisible)

        let dumpsAfterFirstHidden = surface.viewportTextDumpCount
        for _ in 0..<8 {
            XCTAssertTrue(
                fixture.view.readViewportText()?.contains("pier-after-hide") == true
            )
        }
        XCTAssertEqual(surface.viewportTextDumpCount, dumpsAfterFirstHidden + 8)
    }

    func testForcedViewportDumpsDoNotGrowResidentMemoryLinearly() async throws {
        let fixture = try makeFixture(size: NSSize(width: 1920, height: 1080))
        defer { fixture.window.orderOut(nil) }
        await settleRendering()
        let metrics = try XCTUnwrap(fixture.view.surface?.size())
        let columns = max(Int(metrics.columns), 1)
        let rows = max(Int(metrics.rows), 1)
        let line = String(repeating: "w", count: columns)
        fixture.session.receive(
            Array(repeating: line, count: rows).joined(separator: "\n") + "\n"
        )
        let painted = await waitUntil {
            (fixture.session.readViewportText()?.utf8.count ?? 0) >= 12_000
        }
        XCTAssertTrue(painted)
        let dumpBytes = (fixture.session.readViewportText() ?? "").utf8.count
        XCTAssertGreaterThanOrEqual(
            dumpBytes,
            12_000,
            "viewport dump \(dumpBytes) is too small to detect a free_text leak"
        )

        for _ in 0..<8 {
            fixture.session.invalidateViewportTextCache()
            _ = fixture.session.readViewportText()
        }
        let baseline = residentBytes()
        XCTAssertGreaterThan(baseline, 0, "task_info(MACH_TASK_BASIC_INFO) failed")
        let dumpsAtBaseline = fixture.session.viewportTextDumpCount
        for _ in 0..<250 {
            fixture.session.invalidateViewportTextCache()
            _ = fixture.session.readViewportText()
        }
        XCTAssertEqual(fixture.session.viewportTextDumpCount, dumpsAtBaseline + 250)
        let growth = Int64(residentBytes()) - Int64(baseline)
        let leakedIfBroken = Int64(dumpBytes) * 250
        XCTAssertLessThan(
            growth,
            leakedIfBroken / 2,
            "resident growth \(growth) looks like dumpTextLocked leaking (\(dumpBytes) byte dumps)"
        )
    }

    private func makeFixture(
        size: NSSize = NSSize(width: 640, height: 400)
    ) throws -> Fixture {
        let controller = TerminalController { builder in
            builder.withCursorStyleBlink(false)
        }
        let session = InMemoryTerminalSession(write: { _ in }, resize: { _ in })
        let view = TerminalView(frame: .zero)
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        view.controller = controller
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        view.frame = NSRect(origin: .zero, size: size)
        try XCTUnwrap(window.contentView).addSubview(view)
        if size.width > 800 {
            window.orderFront(nil)
        }
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

    private func residentBytes() -> UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(
            MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size
        )
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { rebound in
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), rebound, &count)
            }
        }
        guard result == KERN_SUCCESS else {
            return 0
        }
        return UInt64(info.resident_size)
    }
}

@MainActor
private struct Fixture {
    let session: InMemoryTerminalSession
    let view: TerminalView
    let window: NSWindow
}
