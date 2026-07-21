import AppKit
@testable import GhosttyBridge
import XCTest

@MainActor
final class TerminalWindowTransferTests: XCTestCase {
    private let impl = GhosttyBridgeImpl.shared

    private func scopedKey(browserWindowId: Int, panelId: String) -> String {
        "\(browserWindowId)::\(panelId)"
    }

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

    private func showStateJSON(
        nativePanelId: String,
        viewport: NSRect,
        reason: String,
        sequence: Int
    ) -> String {
        """
        {
          "keyboardTarget": { "kind": "terminal", "panelId": "\(nativePanelId)" },
          "nativeApplySequence": \(sequence),
          "reason": "\(reason)",
          "rendererSequence": \(sequence),
          "terminals": [
            {
              "focused": true,
              "frame": {
                "height": \(viewport.height),
                "width": \(viewport.width),
                "x": \(viewport.minX),
                "y": \(viewport.minY)
              },
              "panelId": "\(nativePanelId)",
              "visible": true
            }
          ],
          "webOverlayRects": [],
          "windowFocused": true
        }
        """
    }

    func testMoveTerminalKeepsSurfaceSessionPidAndSurvivesSourceDetach() async throws {
        let pidPath = NSTemporaryDirectory()
            + "pier-terminal-transfer-\(UUID().uuidString).pid"
        defer { try? FileManager.default.removeItem(atPath: pidPath) }

        let sourceBrowserWindowId = 9101
        let targetBrowserWindowId = 9102
        let rawPanelId = "transfer-terminal-1"
        let fromNativePanelId = scopedKey(
            browserWindowId: sourceBrowserWindowId,
            panelId: rawPanelId
        )
        let toNativePanelId = scopedKey(
            browserWindowId: targetBrowserWindowId,
            panelId: rawPanelId
        )

        let source = makeWindow(
            browserWindowId: sourceBrowserWindowId,
            origin: NSPoint(x: 20, y: 40)
        )
        let target = makeWindow(
            browserWindowId: targetBrowserWindowId,
            origin: NSPoint(x: 860, y: 40)
        )
        defer {
            impl.detachWindow(parent: target)
            // Source may already be detached by the assertion path.
            impl.detachWindow(parent: source)
            source.orderOut(nil)
            target.orderOut(nil)
        }

        let midSource = insertMidWebCompositor(in: source)
        let midTarget = insertMidWebCompositor(in: target)

        let viewport = NSRect(x: 12, y: 24, width: 420, height: 280)
        XCTAssertTrue(
            impl.createTerminal(
                parent: source,
                panelId: fromNativePanelId,
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
        XCTAssertEqual(
            impl.applyWindowState(
                parent: source,
                json: showStateJSON(
                    nativePanelId: fromNativePanelId,
                    viewport: viewport,
                    reason: "move-terminal-source-show",
                    sequence: 1
                )
            ),
            .applied
        )

        let pidText = try await waitForFileContents(pidPath)
        let pid = try XCTUnwrap(Int32(pidText))
        XCTAssertGreaterThan(pid, 1)
        XCTAssertTrue(processIsAlive(pid))

        let before = try XCTUnwrap(impl.terminalIdentityForTests(panelId: fromNativePanelId))
        XCTAssertTrue(before.containerView.superview === source.contentView)
        XCTAssertTrue(before.parentWindow === source)
        XCTAssertEqual(before.browserWindowId, sourceBrowserWindowId)
        XCTAssertEqual(before.containerView.panelId, fromNativePanelId)
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
            impl.moveTerminal(
                fromNativePanelId: fromNativePanelId,
                toNativePanelId: toNativePanelId,
                to: target,
                toBrowserWindowId: targetBrowserWindowId
            ),
            "production scoped-key moveTerminal must succeed"
        )

        XCTAssertNil(impl.terminalIdentityForTests(panelId: fromNativePanelId))
        let afterMove = try XCTUnwrap(impl.terminalIdentityForTests(panelId: toNativePanelId))
        XCTAssertTrue(afterMove.containerView === before.containerView)
        XCTAssertTrue(afterMove.terminalView === before.terminalView)
        XCTAssertEqual(afterMove.surfaceGeneration, before.surfaceGeneration)
        XCTAssertTrue(afterMove.controller === before.controller)
        XCTAssertTrue(afterMove.parentWindow === target)
        XCTAssertEqual(afterMove.browserWindowId, targetBrowserWindowId)
        XCTAssertEqual(afterMove.containerView.panelId, toNativePanelId)
        XCTAssertTrue(afterMove.containerView.superview === target.contentView)
        XCTAssertTrue(afterMove.containerView.isHidden, "move keeps hidden until presentation")
        XCTAssertNil(source.contentView?.subviews.first(where: {
            $0 === before.containerView
        }))
        XCTAssertTrue(afterMove.controller === impl.controllerForTests(window: target))
        XCTAssertNil(impl.controllerForTests(window: source))

        // Source router must drop the old key; target must not route until presentation.
        XCTAssertFalse(
            impl.routerHasTargetForTests(window: source, panelId: fromNativePanelId)
        )
        XCTAssertFalse(
            impl.routerHasTargetForTests(window: target, panelId: toNativePanelId)
        )

        // Present on target — production path uses applyWindowState, not moveTerminal.
        XCTAssertEqual(
            impl.applyWindowState(
                parent: target,
                json: showStateJSON(
                    nativePanelId: toNativePanelId,
                    viewport: targetViewport,
                    reason: "move-terminal-target-show",
                    sequence: 1
                )
            ),
            .applied
        )

        let after = try XCTUnwrap(impl.terminalIdentityForTests(panelId: toNativePanelId))
        XCTAssertFalse(after.containerView.isHidden)
        XCTAssertTrue(after.controller === before.controller)
        XCTAssertTrue(impl.routerHasTargetForTests(window: target, panelId: toNativePanelId))

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

        XCTAssertTrue(processIsAlive(pid), "PTY pid must survive reparent")
        let pidAfterTransfer = try await waitForFileContents(pidPath)
        XCTAssertEqual(pidAfterTransfer, pidText)

        // Closing/detaching the source window must not kill the moved terminal.
        impl.detachWindow(parent: source)
        XCTAssertTrue(
            processIsAlive(pid),
            "detachWindow(source) must not kill the transferred terminal PTY"
        )
        let stillThere = try XCTUnwrap(impl.terminalIdentityForTests(panelId: toNativePanelId))
        XCTAssertTrue(stillThere.terminalView === before.terminalView)
        XCTAssertEqual(stillThere.surfaceGeneration, before.surfaceGeneration)
        XCTAssertTrue(stillThere.parentWindow === target)
        XCTAssertTrue(stillThere.controller === before.controller)
        XCTAssertTrue(processIsAlive(pid))

        // IO still works after source detach: send a no-op-ish text write.
        XCTAssertTrue(impl.sendText(panelId: toNativePanelId, text: "echo transfer-ok\n"))
    }
}
