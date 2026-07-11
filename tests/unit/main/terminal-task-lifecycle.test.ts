import {
  createTerminalTaskLifecycle,
  type TerminalTaskLifecycleDeps,
} from "@main/ipc/terminal-task-lifecycle.ts";
import { describe, expect, it, vi } from "vitest";

function deps(): TerminalTaskLifecycleDeps {
  return {
    completePanel: vi.fn(async () => ({ updated: true })),
    markPanelClosed: vi.fn(),
    now: () => 1_772_000_001_000,
    patchTab: vi.fn(async () => undefined),
    patchTaskStatus: vi.fn(async () => true),
    sessionScopeForBrowserWindow: vi.fn(() => "session-main"),
  };
}

function lifecycleFor(d: TerminalTaskLifecycleDeps) {
  const lifecycle = createTerminalTaskLifecycle(d);
  lifecycle.resetPanel("terminal-1", "run-1", "window-main");
  return lifecycle;
}

describe("terminal task lifecycle", () => {
  it("allows a completion retry after the owner transition throws", async () => {
    const d = deps();
    vi.mocked(d.completePanel)
      .mockRejectedValueOnce(new Error("broadcast failed"))
      .mockResolvedValueOnce({ updated: true });
    const lifecycle = lifecycleFor(d);
    const event = {
      browserWindowId: 42,
      code: 0,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      source: "task-exit-marker" as const,
      windowId: "window-main",
    };

    await expect(lifecycle.completeFromExitCodeHint(event)).rejects.toThrow(
      "broadcast failed"
    );
    await expect(lifecycle.completeFromExitCodeHint(event)).resolves.toBe(true);
    expect(d.completePanel).toHaveBeenCalledTimes(2);
  });

  it("records an exit-code hint and completes from native process close", async () => {
    const d = deps();
    const lifecycle = lifecycleFor(d);

    lifecycle.recordExitCodeHint({
      browserWindowId: 42,
      lifecycleId: "run-1",
      code: 0,
      panelId: "terminal-1",
      source: "task-exit-marker",
      windowId: "window-main",
    });

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      0,
      "run-1",
      "window-main"
    );
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      "run-1",
      {
        exitCode: 0,
        exitReason: "process",
        exitSource: "native-process-close",
        finishedAt: 1_772_000_001_000,
        status: "succeeded",
      }
    );
  });

  it("completes from task-exit title markers without waiting for terminal close", async () => {
    const d = deps();
    const lifecycle = lifecycleFor(d);

    await lifecycle.completeFromExitCodeHint({
      browserWindowId: 42,
      lifecycleId: "run-1",
      code: 0,
      panelId: "terminal-1",
      source: "task-exit-marker",
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      0,
      "run-1",
      "window-main"
    );
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      "run-1",
      expect.objectContaining({
        exitCode: 0,
        exitReason: "process",
        exitSource: "task-exit-marker",
        status: "succeeded",
      })
    );
  });

  it("ignores native process close after task-exit title completion", async () => {
    const d = deps();
    const lifecycle = lifecycleFor(d);

    await lifecycle.completeFromExitCodeHint({
      browserWindowId: 42,
      lifecycleId: "run-1",
      code: 0,
      panelId: "terminal-1",
      source: "task-exit-marker",
      windowId: "window-main",
    });
    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledTimes(1);
    expect(d.patchTaskStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps task-exit title hints over later unknown shell integration codes", async () => {
    const d = deps();
    const lifecycle = lifecycleFor(d);

    lifecycle.recordExitCodeHint({
      browserWindowId: 42,
      lifecycleId: "run-1",
      code: 0,
      panelId: "terminal-1",
      source: "task-exit-marker",
      windowId: "window-main",
    });
    lifecycle.recordExitCodeHint({
      browserWindowId: 42,
      lifecycleId: "run-1",
      code: 1,
      panelId: "terminal-1",
      source: "shell-command-finished",
      windowId: "window-main",
    });

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      0,
      "run-1",
      "window-main"
    );
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      "run-1",
      expect.objectContaining({ exitCode: 0, status: "succeeded" })
    );
  });

  it("uses shell command exit hints when no task-exit marker exists", async () => {
    const d = deps();
    const lifecycle = lifecycleFor(d);

    lifecycle.recordExitCodeHint({
      browserWindowId: 42,
      lifecycleId: "run-1",
      code: 2,
      panelId: "terminal-1",
      source: "shell-command-finished",
      windowId: "window-main",
    });

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      2,
      "run-1",
      "window-main"
    );
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      "run-1",
      expect.objectContaining({
        exitCode: 2,
        exitSource: "native-process-close",
      })
    );
  });

  it("finalizes unknown native process exits instead of leaving tasks running", async () => {
    const d = deps();
    const lifecycle = lifecycleFor(d);

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      1,
      "run-1",
      "window-main"
    );
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      "run-1",
      expect.objectContaining({
        exitReason: "process",
        exitSource: "native-process-close",
        status: "failed",
      })
    );
  });

  it("marks process-alive native closes as user cancellation", async () => {
    const d = deps();
    const lifecycle = lifecycleFor(d);

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      processAlive: true,
      windowId: "window-main",
    });

    expect(d.completePanel).not.toHaveBeenCalled();
    expect(d.markPanelClosed).toHaveBeenCalledWith("terminal-1", "window-main");
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      "run-1",
      expect.objectContaining({
        exitReason: "user",
        exitSource: "panel-close",
        status: "cancelled",
      })
    );
    expect(vi.mocked(d.patchTaskStatus).mock.calls[0]?.[2]).not.toHaveProperty(
      "exitCode"
    );
  });

  it("completes the tracked run and records user cancellation after an interrupt", async () => {
    const d = deps();
    d.isStopRequested = vi.fn(() => true);
    const lifecycle = lifecycleFor(d);

    await lifecycle.completeFromExitCodeHint({
      browserWindowId: 42,
      lifecycleId: "run-1",
      code: 130,
      panelId: "terminal-1",
      source: "shell-command-finished",
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      130,
      "run-1",
      "window-main"
    );
    expect(d.markPanelClosed).not.toHaveBeenCalled();
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      "run-1",
      expect.objectContaining({
        exitCode: 130,
        exitReason: "user",
        status: "cancelled",
      })
    );
  });

  it("still reports process completion when the session has no task identity", async () => {
    const d = deps();
    vi.mocked(d.patchTaskStatus).mockResolvedValue(false);
    const lifecycle = lifecycleFor(d);

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.patchTab).not.toHaveBeenCalled();
    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      1,
      "run-1",
      "window-main"
    );
    expect(d.markPanelClosed).not.toHaveBeenCalled();
  });

  it("reports process completion before a session projection write fails", async () => {
    const d = deps();
    vi.mocked(d.patchTaskStatus).mockRejectedValue(
      new Error("disk unavailable")
    );
    const lifecycle = lifecycleFor(d);

    await expect(
      lifecycle.completeFromExitCodeHint({
        browserWindowId: 42,
        lifecycleId: "run-1",
        code: 2,
        panelId: "terminal-1",
        source: "task-exit-marker",
        windowId: "window-main",
      })
    ).rejects.toThrow("disk unavailable");

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      2,
      "run-1",
      "window-main"
    );
  });

  it("completes the authoritative run when the window session is unavailable", async () => {
    const d = deps();
    vi.mocked(d.sessionScopeForBrowserWindow).mockReturnValue(null);
    const lifecycle = lifecycleFor(d);

    await expect(
      lifecycle.completeFromNativeProcessClose({
        browserWindowId: 42,
        lifecycleId: "run-1",
        panelId: "terminal-1",
        processAlive: false,
        windowId: "window-main",
      })
    ).resolves.toBe(true);

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      1,
      "run-1",
      "window-main"
    );
    expect(d.patchTaskStatus).not.toHaveBeenCalled();
    expect(d.patchTab).not.toHaveBeenCalled();
  });

  it("is idempotent for duplicate completion events", async () => {
    const d = deps();
    const lifecycle = lifecycleFor(d);

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });
    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledTimes(1);
    expect(d.patchTaskStatus).toHaveBeenCalledTimes(1);
  });

  it("resets lifecycle memory when a panel id is reused", async () => {
    const d = deps();
    const lifecycle = lifecycleFor(d);

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    lifecycle.resetPanel("terminal-1", "run-1", "window-main");

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      lifecycleId: "run-1",
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledTimes(2);
    expect(d.patchTaskStatus).toHaveBeenCalledTimes(2);
  });

  it("rejects completion events from a replaced terminal lifecycle", async () => {
    const d = deps();
    const lifecycle = lifecycleFor(d);
    lifecycle.resetPanel("terminal-1", "run-2", "window-main");

    await expect(
      lifecycle.completeFromExitCodeHint({
        browserWindowId: 42,
        code: 143,
        lifecycleId: "run-1",
        panelId: "terminal-1",
        source: "shell-command-finished",
        windowId: "window-main",
      })
    ).resolves.toBe(false);

    expect(d.completePanel).not.toHaveBeenCalled();
    expect(d.patchTaskStatus).not.toHaveBeenCalled();

    await expect(
      lifecycle.completeFromExitCodeHint({
        browserWindowId: 42,
        code: 0,
        lifecycleId: "run-2",
        panelId: "terminal-1",
        source: "task-exit-marker",
        windowId: "window-main",
      })
    ).resolves.toBe(true);
    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      0,
      "run-2",
      "window-main"
    );
  });

  it("scopes an expected relaunch close to the replaced lifecycle", async () => {
    const d = deps();
    const lifecycle = lifecycleFor(d);
    lifecycle.ignoreNextNativeUserClose("terminal-1", "window-main");
    lifecycle.resetPanel("terminal-1", "run-2", "window-main");

    await expect(
      lifecycle.completeFromNativeProcessClose({
        browserWindowId: 42,
        lifecycleId: "run-1",
        panelId: "terminal-1",
        processAlive: true,
        windowId: "window-main",
      })
    ).resolves.toBe(false);
    expect(d.markPanelClosed).not.toHaveBeenCalled();

    await expect(
      lifecycle.completeFromNativeProcessClose({
        browserWindowId: 42,
        lifecycleId: "run-2",
        panelId: "terminal-1",
        processAlive: true,
        windowId: "window-main",
      })
    ).resolves.toBe(true);
    expect(d.markPanelClosed).toHaveBeenCalledWith("terminal-1", "window-main");
  });

  it("releases lifecycle state when the panel is removed", async () => {
    const d = deps();
    const lifecycle = lifecycleFor(d);
    lifecycle.releasePanel("terminal-1", "window-main");

    await expect(
      lifecycle.completeFromNativeProcessClose({
        browserWindowId: 42,
        lifecycleId: "run-1",
        panelId: "terminal-1",
        processAlive: false,
        windowId: "window-main",
      })
    ).resolves.toBe(false);
    expect(d.completePanel).not.toHaveBeenCalled();
  });
});
