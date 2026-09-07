import AppKit
@testable import GhosttyBridge
import XCTest

@MainActor
final class TerminalChildExitRetainTests: XCTestCase {
    private let impl = GhosttyBridgeImpl.shared

    func testAgentLifecycleRetainsAfterChildExitWhileShellDoesNot() {
        let agent = TerminalEventDelegate(
            panelId: "agent-panel",
            browserWindowId: 1,
            lifecycleId: "agent-run-1"
        )
        XCTAssertTrue(agent.retainSurfaceAfterChildExit)
        let shell = TerminalEventDelegate(
            panelId: "shell-panel",
            browserWindowId: 1,
            lifecycleId: "shell:1"
        )
        XCTAssertFalse(shell.retainSurfaceAfterChildExit)
        let unnamed = TerminalEventDelegate(
            panelId: "unnamed",
            browserWindowId: 1,
            lifecycleId: ""
        )
        XCTAssertFalse(unnamed.retainSurfaceAfterChildExit)
    }

    func testShellRetainCanBeArmedForOscDetectedAgent() {
        let shell = TerminalEventDelegate(
            panelId: "shell-panel",
            browserWindowId: 1,
            lifecycleId: "shell:1"
        )
        XCTAssertFalse(shell.retainSurfaceAfterChildExit)
        shell.retainSurfaceAfterChildExit = true
        XCTAssertTrue(shell.retainSurfaceAfterChildExit)
    }

    func testAgentChildExitKeepsSurfaceAndDoesNotRequestClose() async throws {
        let pidPath = NSTemporaryDirectory()
            + "pier-child-exit-\(UUID().uuidString).pid"
        defer { try? FileManager.default.removeItem(atPath: pidPath) }

        let browserWindowId = 9201
        let nativePanelId = "\(browserWindowId)::agent-exit"
        let window = makeWindow(browserWindowId: browserWindowId)
        defer {
            impl.detachWindow(parent: window)
            window.orderOut(nil)
        }
        insertWebCompositorStandIn(in: window)

        final class Flags: @unchecked Sendable {
            var closed = false
            var exited = false
        }
        let flags = Flags()
        let previousClose = TerminalEventDelegate.forwardProcessClosedCallback
        let previousExit = TerminalEventDelegate.forwardChildExitedCallback
        TerminalEventDelegate.forwardProcessClosedCallback = {
            windowId,
            panelId,
            lifecycleId,
            processAlive in
            if panelId == nativePanelId { flags.closed = true }
            previousClose?(windowId, panelId, lifecycleId, processAlive)
        }
        TerminalEventDelegate.forwardChildExitedCallback = {
            windowId,
            panelId,
            lifecycleId,
            exitCode,
            runtimeMs in
            if panelId == nativePanelId { flags.exited = true }
            previousExit?(windowId, panelId, lifecycleId, exitCode, runtimeMs)
        }
        defer {
            TerminalEventDelegate.forwardProcessClosedCallback = previousClose
            TerminalEventDelegate.forwardChildExitedCallback = previousExit
        }

        let viewport = NSRect(x: 12, y: 24, width: 420, height: 280)
        XCTAssertTrue(
            impl.createTerminal(
                parent: window,
                panelId: nativePanelId,
                viewport: viewport,
                fontFamily: "Menlo",
                fontSize: 13,
                workingDirectory: NSTemporaryDirectory(),
                command: """
                /bin/sh -c 'printf %s $$ > "\(pidPath)"; echo EXIT_READY; sleep 1; exit 0'
                """,
                environment: [:],
                lifecycleId: "agent-exit-retain-1",
                hostManaged: false
            )
        )
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: showStateJSON(
                    nativePanelId: nativePanelId,
                    viewport: viewport
                )
            ),
            .applied
        )

        _ = try await waitForFileContents(pidPath)
        let painted = await waitUntil {
            self.impl.readViewportText(panelId: nativePanelId)?.contains("EXIT_READY")
                == true
        }
        XCTAssertTrue(painted)
        let exited = await waitUntil { flags.exited }
        XCTAssertTrue(
            exited,
            "SHOW_CHILD_EXITED should reach the host for an agent surface"
        )
        try await Task.sleep(nanoseconds: 250_000_000)
        XCTAssertFalse(
            flags.closed,
            "agent child exit must not request surface close"
        )
        XCTAssertNotNil(impl.terminalIdentityForTests(panelId: nativePanelId))
        XCTAssertTrue(
            impl.readViewportText(panelId: nativePanelId)?.contains("EXIT_READY")
                == true
        )
    }

    func testArmedShellChildExitKeepsSurfaceAndDoesNotRequestClose() async throws {
        let pidPath = NSTemporaryDirectory()
            + "pier-child-exit-shell-\(UUID().uuidString).pid"
        defer { try? FileManager.default.removeItem(atPath: pidPath) }

        let browserWindowId = 9202
        let nativePanelId = "\(browserWindowId)::shell-exit"
        let lifecycleId = "shell:osc-retain-1"
        let window = makeWindow(browserWindowId: browserWindowId)
        defer {
            impl.detachWindow(parent: window)
            window.orderOut(nil)
        }
        insertWebCompositorStandIn(in: window)

        final class Flags: @unchecked Sendable {
            var closed = false
            var exited = false
        }
        let flags = Flags()
        let previousClose = TerminalEventDelegate.forwardProcessClosedCallback
        let previousExit = TerminalEventDelegate.forwardChildExitedCallback
        TerminalEventDelegate.forwardProcessClosedCallback = {
            windowId,
            panelId,
            lifecycleId,
            processAlive in
            if panelId == nativePanelId { flags.closed = true }
            previousClose?(windowId, panelId, lifecycleId, processAlive)
        }
        TerminalEventDelegate.forwardChildExitedCallback = {
            windowId,
            panelId,
            lifecycleId,
            exitCode,
            runtimeMs in
            if panelId == nativePanelId { flags.exited = true }
            previousExit?(windowId, panelId, lifecycleId, exitCode, runtimeMs)
        }
        defer {
            TerminalEventDelegate.forwardProcessClosedCallback = previousClose
            TerminalEventDelegate.forwardChildExitedCallback = previousExit
        }

        let viewport = NSRect(x: 12, y: 24, width: 420, height: 280)
        XCTAssertTrue(
            impl.createTerminal(
                parent: window,
                panelId: nativePanelId,
                viewport: viewport,
                fontFamily: "Menlo",
                fontSize: 13,
                workingDirectory: NSTemporaryDirectory(),
                command: """
                /bin/sh -c 'printf %s $$ > "\(pidPath)"; echo EXIT_READY; sleep 1; exit 0'
                """,
                environment: [:],
                lifecycleId: lifecycleId,
                hostManaged: false
            )
        )
        XCTAssertTrue(
            impl.setRetainAfterExit(
                panelId: nativePanelId,
                lifecycleId: lifecycleId,
                retain: true
            )
        )
        XCTAssertEqual(
            impl.applyWindowState(
                parent: window,
                json: showStateJSON(
                    nativePanelId: nativePanelId,
                    viewport: viewport
                )
            ),
            .applied
        )

        _ = try await waitForFileContents(pidPath)
        let painted = await waitUntil {
            self.impl.readViewportText(panelId: nativePanelId)?.contains("EXIT_READY")
                == true
        }
        XCTAssertTrue(painted)
        let exited = await waitUntil { flags.exited }
        XCTAssertTrue(
            exited,
            "SHOW_CHILD_EXITED should reach the host for an armed shell surface"
        )
        try await Task.sleep(nanoseconds: 250_000_000)
        XCTAssertFalse(
            flags.closed,
            "OSC-armed shell child exit must not request surface close"
        )
        XCTAssertNotNil(impl.terminalIdentityForTests(panelId: nativePanelId))
        XCTAssertTrue(
            impl.readViewportText(panelId: nativePanelId)?.contains("EXIT_READY")
                == true
        )
    }

    private func makeWindow(browserWindowId: Int) -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 40, y: 40, width: 800, height: 600),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        XCTAssertTrue(impl.setupWindow(parent: window, browserWindowId: browserWindowId))
        return window
    }

    private func showStateJSON(nativePanelId: String, viewport: NSRect) -> String {
        """
        {
          "keyboardTarget": { "kind": "terminal", "panelId": "\(nativePanelId)" },
          "nativeApplySequence": 1,
          "reason": "child-exit-retain",
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
              "panelId": "\(nativePanelId)",
              "visible": true
            }
          ],
          "webOverlayRects": [],
          "windowFocused": true
        }
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

    private func waitUntil(
        timeout: TimeInterval = 5,
        condition: @escaping @MainActor () -> Bool
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        return condition()
    }
}
