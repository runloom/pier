@_spi(PierDiagnostics) @testable import GhosttyTerminal
import AppKit
import XCTest

@MainActor
final class TerminalControllerWakeupTests: XCTestCase {
    func testRuntimeWakeupTicksAppWhileEverySurfaceIsHidden() async throws {
        let fixture = try makeTwoSurfaceFixture()
        defer { fixture.window.orderOut(nil) }
        await settleRendering()
        fixture.first.setSurfaceVisible(false)
        fixture.second.setSurfaceVisible(false)
        let tickBaseline = fixture.controller.pierDiagnostics.appTickCount
        let firstDrawBaseline = fixture.first.pierRenderDiagnostics.drawSequence
        let secondDrawBaseline = fixture.second.pierRenderDiagnostics.drawSequence

        fixture.controller.handleWakeup()
        await settleRendering()

        XCTAssertEqual(fixture.controller.pierDiagnostics.appTickCount, tickBaseline + 1)
        XCTAssertEqual(fixture.first.pierRenderDiagnostics.drawSequence, firstDrawBaseline)
        XCTAssertEqual(fixture.second.pierRenderDiagnostics.drawSequence, secondDrawBaseline)
    }

    func testOutputRendersOnlyItsTargetSurfaceWithoutFocusOrClick() async throws {
        let fixture = try makeTwoSurfaceFixture()
        defer { fixture.window.orderOut(nil) }
        await settleRendering()
        let firstBaseline = fixture.first.pierRenderDiagnostics
        let secondBaseline = fixture.second.pierRenderDiagnostics

        fixture.firstSession.receive("pier-target-a\n")

        let renderedTarget = await waitUntil {
            fixture.firstSession.readViewportText()?.contains("pier-target-a") == true
                && fixture.first.pierRenderDiagnostics.drawSequence
                    > firstBaseline.drawSequence
        }
        XCTAssertTrue(renderedTarget)
        XCTAssertGreaterThan(
            fixture.first.pierRenderDiagnostics.ghosttyRenderReadySequence,
            firstBaseline.ghosttyRenderReadySequence
        )
        XCTAssertEqual(
            fixture.second.pierRenderDiagnostics.ghosttyRenderReadySequence,
            secondBaseline.ghosttyRenderReadySequence
        )
        XCTAssertEqual(
            fixture.second.pierRenderDiagnostics.drawSequence,
            secondBaseline.drawSequence
        )
    }

    func testRenderReadyRequestsCoalesceWithoutRefreshingOrRetickingApp() async throws {
        let fixture = try makeOneSurfaceFixture()
        defer { fixture.window.orderOut(nil) }
        await settleRendering()
        let bridge = try XCTUnwrap(fixture.controller.retainedBridges.first)
        let baseline = fixture.view.pierRenderDiagnostics
        let tickBaseline = fixture.controller.pierDiagnostics.appTickCount

        for _ in 0..<5 {
            bridge.handleRenderReady()
        }
        let pending = fixture.view.pierRenderDiagnostics
        XCTAssertEqual(
            pending.ghosttyRenderReadySequence,
            baseline.ghosttyRenderReadySequence + 5
        )
        XCTAssertTrue(pending.drawPending)

        await settleRendering()
        let rendered = fixture.view.pierRenderDiagnostics
        XCTAssertEqual(rendered.drawSequence, baseline.drawSequence + 1)
        XCTAssertEqual(
            rendered.lastDrawnGhosttyRenderReadySequence,
            rendered.ghosttyRenderReadySequence
        )
        XCTAssertEqual(
            rendered.hostRefreshRequestSequence,
            baseline.hostRefreshRequestSequence
        )
        XCTAssertEqual(fixture.controller.pierDiagnostics.appTickCount, tickBaseline)

        await drainMainQueue(turns: 8)
        XCTAssertEqual(fixture.view.pierRenderDiagnostics.drawSequence, rendered.drawSequence)
        XCTAssertEqual(
            fixture.view.pierRenderDiagnostics.ghosttyRenderReadySequence,
            rendered.ghosttyRenderReadySequence
        )
    }

    func testHiddenOutputAdvancesViewportAndRestoresTargetDraw() async throws {
        let fixture = try makeOneSurfaceFixture()
        defer { fixture.window.orderOut(nil) }
        await settleRendering()
        fixture.view.setSurfaceVisible(false)
        let hiddenBaseline = fixture.view.pierRenderDiagnostics

        fixture.session.receive("pier-hidden-final\n")

        let hiddenOutputProcessed = await waitUntil {
            fixture.session.readViewportText()?.contains("pier-hidden-final") == true
        }
        XCTAssertTrue(hiddenOutputProcessed)
        XCTAssertEqual(
            fixture.view.pierRenderDiagnostics.drawSequence,
            hiddenBaseline.drawSequence
        )

        fixture.view.setSurfaceVisible(true)
        let restored = await waitUntil {
            fixture.view.pierRenderDiagnostics.drawSequence
                > hiddenBaseline.drawSequence
        }
        XCTAssertTrue(restored)
        await drainMainQueue(turns: 8)
        let restoredDiagnostics = fixture.view.pierRenderDiagnostics
        XCTAssertGreaterThan(
            restoredDiagnostics.drawSequence,
            hiddenBaseline.drawSequence
        )
        XCTAssertFalse(restoredDiagnostics.refreshPending)
        XCTAssertFalse(restoredDiagnostics.drawPending)
        XCTAssertEqual(
            restoredDiagnostics.lastDrawnGhosttyRenderReadySequence,
            restoredDiagnostics.ghosttyRenderReadySequence
        )
        XCTAssertTrue(
            fixture.session.readViewportText()?.contains("pier-hidden-final") == true
        )
    }

    func testStaleBridgeCannotRenderRebuiltSurfaceGeneration() async throws {
        let fixture = try makeOneSurfaceFixture()
        defer { fixture.window.orderOut(nil) }
        await settleRendering()
        let staleBridge = try XCTUnwrap(fixture.controller.retainedBridges.first)
        let previousGeneration = fixture.view.pierRenderDiagnostics.surfaceGeneration

        staleBridge.handleRenderReady()
        XCTAssertTrue(fixture.view.pierRenderDiagnostics.drawPending)
        fixture.view.controller = makeController()
        await settleRendering()
        let rebuiltBaseline = fixture.view.pierRenderDiagnostics

        XCTAssertGreaterThan(
            rebuiltBaseline.surfaceGeneration,
            previousGeneration
        )
        XCTAssertEqual(
            fixture.view.pierRenderDiagnostics.ghosttyRenderReadySequence,
            rebuiltBaseline.ghosttyRenderReadySequence
        )
        XCTAssertEqual(
            fixture.view.pierRenderDiagnostics.drawSequence,
            rebuiltBaseline.drawSequence
        )
    }

    func testSeparateControllersDoNotCrossWindowOrSurfaceBoundaries() async throws {
        let first = try makeOneSurfaceFixture()
        let second = try makeOneSurfaceFixture()
        defer {
            first.window.orderOut(nil)
            second.window.orderOut(nil)
        }
        await settleRendering()
        let secondTickBaseline = second.controller.pierDiagnostics.appTickCount
        let secondRenderBaseline = second.view.pierRenderDiagnostics
        let firstDrawBaseline = first.view.pierRenderDiagnostics.drawSequence

        first.session.receive("pier-window-one\n")

        let firstWindowRendered = await waitUntil {
            first.session.readViewportText()?.contains("pier-window-one") == true
                && first.view.pierRenderDiagnostics.drawSequence > firstDrawBaseline
        }
        XCTAssertTrue(firstWindowRendered)
        XCTAssertEqual(second.controller.pierDiagnostics.appTickCount, secondTickBaseline)
        XCTAssertEqual(
            second.view.pierRenderDiagnostics.ghosttyRenderReadySequence,
            secondRenderBaseline.ghosttyRenderReadySequence
        )
        XCTAssertEqual(
            second.view.pierRenderDiagnostics.drawSequence,
            secondRenderBaseline.drawSequence
        )
    }

    private func makeTwoSurfaceFixture() throws -> TwoSurfaceFixture {
        let controller = makeController()
        let firstSession = makeSession()
        let secondSession = makeSession()
        let first = makeTerminalView(controller: controller, session: firstSession)
        let second = makeTerminalView(controller: controller, session: secondSession)
        let window = makeWindow()
        let contentView = try XCTUnwrap(window.contentView)
        first.frame = NSRect(x: 0, y: 0, width: 320, height: 400)
        second.frame = NSRect(x: 320, y: 0, width: 320, height: 400)
        contentView.addSubview(first)
        contentView.addSubview(second)
        return TwoSurfaceFixture(
            controller: controller,
            first: first,
            firstSession: firstSession,
            second: second,
            secondSession: secondSession,
            window: window
        )
    }

    private func makeOneSurfaceFixture() throws -> OneSurfaceFixture {
        let controller = makeController()
        let session = makeSession()
        let view = makeTerminalView(controller: controller, session: session)
        let window = makeWindow()
        view.frame = NSRect(x: 0, y: 0, width: 640, height: 400)
        try XCTUnwrap(window.contentView).addSubview(view)
        return OneSurfaceFixture(
            controller: controller,
            session: session,
            view: view,
            window: window
        )
    }

    private func makeController() -> TerminalController {
        TerminalController { builder in
            builder.withCursorStyleBlink(false)
        }
    }

    private func makeSession() -> InMemoryTerminalSession {
        InMemoryTerminalSession(write: { _ in }, resize: { _ in })
    }

    private func makeTerminalView(
        controller: TerminalController,
        session: InMemoryTerminalSession
    ) -> TerminalView {
        let view = TerminalView(frame: .zero)
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        view.controller = controller
        return view
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

@MainActor
private struct OneSurfaceFixture {
    let controller: TerminalController
    let session: InMemoryTerminalSession
    let view: TerminalView
    let window: NSWindow
}

@MainActor
private struct TwoSurfaceFixture {
    let controller: TerminalController
    let first: TerminalView
    let firstSession: InMemoryTerminalSession
    let second: TerminalView
    let secondSession: InMemoryTerminalSession
    let window: NSWindow
}
