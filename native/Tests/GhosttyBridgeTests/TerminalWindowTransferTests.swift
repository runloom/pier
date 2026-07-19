import AppKit
@testable import GhosttyBridge
import XCTest

@MainActor
final class TerminalWindowTransferTests: XCTestCase {
    private let impl = GhosttyBridgeImpl.shared

    private func makeWindow(
        browserWindowId: Int,
        origin: NSPoint = NSPoint(x: 40, y: 40)
    ) -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: origin.x, y: origin.y, width: 800, height: 600),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        XCTAssertTrue(impl.setupWindow(parent: window, browserWindowId: browserWindowId))
        return window
    }

    private func insertMidWebCompositor(in window: NSWindow) -> NSView {
        let contentView = try! XCTUnwrap(window.contentView)
        let mid = NSView(frame: contentView.bounds)
        mid.identifier = NSUserInterfaceItemIdentifier("spike-web-compositor")
        mid.wantsLayer = true
        mid.autoresizingMask = [.width, .height]
        // Between terminal (bottom) and EventRouterView (top).
        contentView.addSubview(mid, positioned: .above, relativeTo: nil)
        // Ensure EventRouter stays top-most after inserting mid layer.
        if let router = contentView.subviews.first(where: { $0 is EventRouterView }) {
            contentView.addSubview(router, positioned: .above, relativeTo: nil)
        }
        return mid
    }

    private func pidFileCommand(path: String) -> String {
        """
        /bin/sh -c 'printf %s $$ > "\(path)"; while true; do sleep 1; done'
        """
    }

    private func waitForFileContents(
        _ path: String,
        timeout: TimeInterval = 5
    ) async throws -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
               let text = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
               !text.isEmpty
            {
                return text
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        struct Timeout: Error {}
        throw Timeout()
    }

    private func processIsAlive(_ pid: Int32) -> Bool {
        kill(pid, 0) == 0
    }

    func testTransferTerminalKeepsSurfaceSessionPidAndSurvivesSourceDetach() async throws {
        let pidPath = NSTemporaryDirectory()
            + "pier-terminal-transfer-\(UUID().uuidString).pid"
        defer { try? FileManager.default.removeItem(atPath: pidPath) }

        let source = makeWindow(browserWindowId: 9101, origin: NSPoint(x: 20, y: 40))
        let target = makeWindow(browserWindowId: 9102, origin: NSPoint(x: 860, y: 40))
        defer {
            impl.detachWindow(parent: target)
            // Source may already be detached by the assertion path.
            impl.detachWindow(parent: source)
            source.orderOut(nil)
            target.orderOut(nil)
        }

        let midSource = insertMidWebCompositor(in: source)
        let midTarget = insertMidWebCompositor(in: target)

        let panelId = "transfer-terminal-1"
        let viewport = NSRect(x: 12, y: 24, width: 420, height: 280)
        XCTAssertTrue(
            impl.createTerminal(
                parent: source,
                panelId: panelId,
                viewport: viewport,
                fontFamily: "Menlo",
                fontSize: 13,
                workingDirectory: NSTemporaryDirectory(),
                command: pidFileCommand(path: pidPath),
                environment: [:],
                lifecycleId: "lifecycle-transfer-1",
                hostManaged: false
            )
        )

        // Make the surface visible so the exec PTY actually starts.
        let showState = """
        {
          "keyboardTarget": { "kind": "terminal", "panelId": "\(panelId)" },
          "nativeApplySequence": 1,
          "reason": "spike-transfer-show",
          "rendererSequence": 1,
          "terminals": [
            {
              "focused": true,
              "frame": {
                "height": \(viewport.height),
                "width": \(viewport.width),
                "x": \(viewport.minX),
                "y": \(viewport.minY)
              },
              "panelId": "\(panelId)",
              "visible": true
            }
          ],
          "webOverlayRects": [],
          "windowFocused": true
        }
        """
        XCTAssertEqual(impl.applyWindowState(parent: source, json: showState), .applied)

        let pidText = try await waitForFileContents(pidPath)
        let pid = try XCTUnwrap(Int32(pidText))
        XCTAssertGreaterThan(pid, 1)
        XCTAssertTrue(processIsAlive(pid))

        let before = try XCTUnwrap(impl.terminalIdentityForTests(panelId: panelId))
        XCTAssertTrue(before.containerView.superview === source.contentView)
        XCTAssertTrue(before.parentWindow === source)
        XCTAssertEqual(before.browserWindowId, 9101)
        XCTAssertTrue(before.controller === impl.controllerForTests(window: source))

        // Layer order on source: terminal bottom, mid compositor, EventRouter top.
        let sourceSubs = try XCTUnwrap(source.contentView?.subviews)
        let sourceTerminalIndex = try XCTUnwrap(sourceSubs.firstIndex(where: {
            $0 === before.containerView
        }))
        let sourceMidIndex = try XCTUnwrap(sourceSubs.firstIndex(where: { $0 === midSource }))
        let sourceRouterIndex = try XCTUnwrap(sourceSubs.firstIndex(where: {
            $0 is EventRouterView
        }))
        XCTAssertLessThan(sourceTerminalIndex, sourceMidIndex)
        XCTAssertLessThan(sourceMidIndex, sourceRouterIndex)
        XCTAssertFalse(before.containerView.superview is EventRouterView)

        let targetViewport = NSRect(x: 30, y: 40, width: 440, height: 300)
        XCTAssertTrue(
            impl.transferTerminalForTests(
                panelId: panelId,
                to: target,
                toBrowserWindowId: 9102,
                viewport: targetViewport
            ),
            "minimal same-surface reparent entry must succeed"
        )

        let after = try XCTUnwrap(impl.terminalIdentityForTests(panelId: panelId))
        XCTAssertTrue(after.containerView === before.containerView)
        XCTAssertTrue(after.terminalView === before.terminalView)
        XCTAssertEqual(after.surfaceGeneration, before.surfaceGeneration)
        XCTAssertTrue(after.controller === before.controller)
        XCTAssertTrue(after.parentWindow === target)
        XCTAssertEqual(after.browserWindowId, 9102)
        XCTAssertTrue(after.containerView.superview === target.contentView)
        XCTAssertNil(source.contentView?.subviews.first(where: {
            $0 === before.containerView
        }))
        XCTAssertTrue(after.controller === impl.controllerForTests(window: target))
        XCTAssertNil(impl.controllerForTests(window: source))

        // Target layer order still has terminal under mid compositor / EventRouter.
        let targetSubs = try XCTUnwrap(target.contentView?.subviews)
        let targetTerminalIndex = try XCTUnwrap(targetSubs.firstIndex(where: {
            $0 === after.containerView
        }))
        let targetMidIndex = try XCTUnwrap(targetSubs.firstIndex(where: { $0 === midTarget }))
        let targetRouterIndex = try XCTUnwrap(targetSubs.firstIndex(where: {
            $0 is EventRouterView
        }))
        XCTAssertLessThan(targetTerminalIndex, targetMidIndex)
        XCTAssertLessThan(targetMidIndex, targetRouterIndex)

        // Source router must not keep the moved panel target; target router must.
        XCTAssertFalse(impl.routerHasTargetForTests(window: source, panelId: panelId))
        XCTAssertTrue(impl.routerHasTargetForTests(window: target, panelId: panelId))

        XCTAssertTrue(processIsAlive(pid), "PTY pid must survive reparent")
        let pidAfterTransfer = try await waitForFileContents(pidPath)
        XCTAssertEqual(pidAfterTransfer, pidText)

        // Closing/detaching the source window must not kill the moved terminal.
        impl.detachWindow(parent: source)
        XCTAssertTrue(
            processIsAlive(pid),
            "detachWindow(source) must not kill the transferred terminal PTY"
        )
        let stillThere = try XCTUnwrap(impl.terminalIdentityForTests(panelId: panelId))
        XCTAssertTrue(stillThere.terminalView === before.terminalView)
        XCTAssertEqual(stillThere.surfaceGeneration, before.surfaceGeneration)
        XCTAssertTrue(stillThere.parentWindow === target)
        XCTAssertTrue(processIsAlive(pid))

        // IO still works after source detach: send a no-op-ish text write.
        XCTAssertTrue(impl.sendText(panelId: panelId, text: "echo transfer-ok\n"))
    }
}
