import AppKit
@testable import GhosttyBridge
@_spi(PierDiagnostics) import GhosttyTerminal
import XCTest

@MainActor
final class TerminalFlickerPreventionTests: XCTestCase {
    func testPixelGeometryTruncatesLikeGhosttyZig() {
        let pixels = TerminalPixelGeometry.pixels(
            size: (width: 100.9, height: 50.1),
            scale: 2.0
        )
        XCTAssertEqual(pixels?.width, 201)
        XCTAssertEqual(pixels?.height, 100)

        let fractional = TerminalPixelGeometry.pixels(
            size: CGSize(width: 333.3, height: 200.0),
            scale: 1.25
        )
        XCTAssertEqual(fractional?.width, 416)
        XCTAssertEqual(fractional?.height, 250)

        let drawable = TerminalPixelGeometry.drawableSize(
            pixels: TerminalPixelGeometry.Pixels(width: 960, height: 640)
        )
        XCTAssertEqual(drawable.width, 960)
        XCTAssertEqual(drawable.height, 640)
    }

    func testFitToSizeSkipsRefreshWhenPixelsUnchanged() async throws {
        let fixture = try makeOneSurfaceFixture()
        defer { fixture.window.orderOut(nil) }
        await settleRendering()
        let baseline = fixture.view.pierRenderDiagnostics

        fixture.view.fitToSize()
        fixture.view.fitToSize()
        let after = fixture.view.pierRenderDiagnostics

        XCTAssertEqual(after.hostRefreshRequestSequence, baseline.hostRefreshRequestSequence)
        XCTAssertEqual(after.drawSequence, baseline.drawSequence)
    }

    func testScrollbarStateDoesNotBumpHostRefresh() async throws {
        let (container, scrollView) = try makeContainer()
        let controller = TerminalController { builder in
            builder.withCursorStyleBlink(false)
        }
        let session = InMemoryTerminalSession(write: { _ in }, resize: { _ in })
        container.terminalView.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        container.terminalView.controller = controller
        let window = makeWindow()
        try XCTUnwrap(window.contentView).addSubview(container)
        defer { window.orderOut(nil) }
        await settleRendering()

        let baseline = container.terminalView.pierRenderDiagnostics
        scrollView.applyScrollbarState(
            TerminalScrollbarState(total: 40, offset: 0, length: 20)
        )
        scrollView.applyScrollbarState(
            TerminalScrollbarState(total: 80, offset: 5, length: 20)
        )
        let after = container.terminalView.pierRenderDiagnostics

        XCTAssertEqual(after.hostRefreshRequestSequence, baseline.hostRefreshRequestSequence)
    }

    func testBackgroundColorPropagatesThroughScrollStack() throws {
        let (container, scrollView) = try makeContainer()
        let color = NSColor(calibratedRed: 0.1, green: 0.2, blue: 0.3, alpha: 1)

        container.backgroundColor = color

        XCTAssertEqual(container.layer?.backgroundColor, color.cgColor)
        XCTAssertEqual(scrollView.layer?.backgroundColor, color.cgColor)
        XCTAssertEqual(container.terminalView.layer?.backgroundColor, color.cgColor)
    }

    func testPresentationCoverForceUncoversAfterTimeout() async throws {
        let (container, _) = try makeContainer()
        let request = TerminalFramePresentationRequest(
            pixelHeight: 640,
            pixelWidth: 960,
            requestSequence: 4,
            surfaceGeneration: 7
        )
        container.handlePresentationRequest(request)
        XCTAssertTrue(container.isPresentationCovered)

        let uncovered = await waitUntil(timeout: 1.5) {
            !container.isPresentationCovered
        }
        XCTAssertTrue(uncovered)
    }

    private func makeContainer() throws -> (TerminalContainerView, AppTerminalScrollView) {
        let terminalView = TerminalView(frame: .zero)
        let container = TerminalContainerView(
            frame: NSRect(x: 0, y: 0, width: 100, height: 80),
            terminalView: terminalView,
            panelId: "terminal-flicker-1",
            browserWindowId: 42
        )
        container.applyHostFrame(NSRect(x: 0, y: 0, width: 480, height: 320))
        let scrollView = try XCTUnwrap(container.subviews.first as? AppTerminalScrollView)
        return (container, scrollView)
    }

    private func makeOneSurfaceFixture() throws -> (view: TerminalView, window: NSWindow) {
        let controller = TerminalController { builder in
            builder.withCursorStyleBlink(false)
        }
        let session = InMemoryTerminalSession(write: { _ in }, resize: { _ in })
        let view = TerminalView(frame: .zero)
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        view.controller = controller
        let window = makeWindow()
        view.frame = NSRect(x: 0, y: 0, width: 640, height: 400)
        try XCTUnwrap(window.contentView).addSubview(view)
        return (view, window)
    }

    private func makeWindow() -> NSWindow {
        NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 400),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
    }

    private func drainMainQueue(turns: Int = 4) async {
        for _ in 0..<turns {
            await withCheckedContinuation { continuation in
                DispatchQueue.main.async {
                    continuation.resume()
                }
            }
        }
    }

    private func settleRendering() async {
        for _ in 0..<5 {
            await drainMainQueue()
            try? await Task.sleep(for: .milliseconds(50))
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
