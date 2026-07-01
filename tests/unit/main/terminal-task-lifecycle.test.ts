import {
  createTerminalTaskLifecycle,
  type TerminalTaskLifecycleDeps,
} from "@main/ipc/terminal-task-lifecycle.ts";
import { describe, expect, it, vi } from "vitest";

function deps(): TerminalTaskLifecycleDeps {
  return {
    completePanel: vi.fn(async () => ({ updated: true })),
    forwardTabPatch: vi.fn(),
    markPanelClosed: vi.fn(),
    now: () => 1_772_000_001_000,
    patchTab: vi.fn(async () => undefined),
    patchTaskStatus: vi.fn(async () => true),
    sessionScopeForBrowserWindow: vi.fn(() => "session-main"),
  };
}

describe("terminal task lifecycle", () => {
  it("records an exit-code hint and completes from native process close", async () => {
    const d = deps();
    const lifecycle = createTerminalTaskLifecycle(d);

    lifecycle.recordExitCodeHint({
      browserWindowId: 42,
      code: 0,
      panelId: "terminal-1",
      source: "task-exit-marker",
      windowId: "window-main",
    });

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      0,
      "window-main"
    );
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      {
        exitCode: 0,
        exitReason: "process",
        exitSource: "native-process-close",
        finishedAt: 1_772_000_001_000,
        status: "succeeded",
      }
    );
    expect(d.forwardTabPatch).toHaveBeenCalledWith(42, "terminal-1", {
      state: {
        colorToken: "success",
        label: "Succeeded",
        status: "succeeded",
      },
    });
  });

  it("completes from task-exit title markers without waiting for terminal close", async () => {
    const d = deps();
    const lifecycle = createTerminalTaskLifecycle(d);

    await lifecycle.completeFromExitCodeHint({
      browserWindowId: 42,
      code: 0,
      panelId: "terminal-1",
      source: "task-exit-marker",
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      0,
      "window-main"
    );
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
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
    const lifecycle = createTerminalTaskLifecycle(d);

    await lifecycle.completeFromExitCodeHint({
      browserWindowId: 42,
      code: 0,
      panelId: "terminal-1",
      source: "task-exit-marker",
      windowId: "window-main",
    });
    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledTimes(1);
    expect(d.patchTaskStatus).toHaveBeenCalledTimes(1);
    expect(d.forwardTabPatch).toHaveBeenCalledTimes(1);
  });

  it("keeps task-exit title hints over later unknown shell integration codes", async () => {
    const d = deps();
    const lifecycle = createTerminalTaskLifecycle(d);

    lifecycle.recordExitCodeHint({
      browserWindowId: 42,
      code: 0,
      panelId: "terminal-1",
      source: "task-exit-marker",
      windowId: "window-main",
    });
    lifecycle.recordExitCodeHint({
      browserWindowId: 42,
      code: 1,
      panelId: "terminal-1",
      source: "shell-command-finished",
      windowId: "window-main",
    });

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      0,
      "window-main"
    );
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      expect.objectContaining({ exitCode: 0, status: "succeeded" })
    );
  });

  it("uses shell command exit hints when no task-exit marker exists", async () => {
    const d = deps();
    const lifecycle = createTerminalTaskLifecycle(d);

    lifecycle.recordExitCodeHint({
      browserWindowId: 42,
      code: 2,
      panelId: "terminal-1",
      source: "shell-command-finished",
      windowId: "window-main",
    });

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      2,
      "window-main"
    );
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      expect.objectContaining({
        exitCode: 2,
        exitSource: "native-process-close",
      })
    );
  });

  it("finalizes unknown native process exits instead of leaving tasks running", async () => {
    const d = deps();
    const lifecycle = createTerminalTaskLifecycle(d);

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledWith(
      "terminal-1",
      1,
      "window-main"
    );
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      expect.objectContaining({
        exitReason: "process",
        exitSource: "native-process-close",
        status: "failed",
      })
    );
    expect(d.forwardTabPatch).toHaveBeenCalledWith(42, "terminal-1", {
      state: {
        colorToken: "destructive",
        label: "Failed",
        status: "failed",
      },
    });
  });

  it("marks process-alive native closes as user cancellation", async () => {
    const d = deps();
    const lifecycle = createTerminalTaskLifecycle(d);

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      panelId: "terminal-1",
      processAlive: true,
      windowId: "window-main",
    });

    expect(d.completePanel).not.toHaveBeenCalled();
    expect(d.markPanelClosed).toHaveBeenCalledWith("terminal-1", "window-main");
    expect(d.patchTaskStatus).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
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

  it("does not forward tab chrome when the session has no task identity", async () => {
    const d = deps();
    vi.mocked(d.patchTaskStatus).mockResolvedValue(false);
    const lifecycle = createTerminalTaskLifecycle(d);

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.forwardTabPatch).not.toHaveBeenCalled();
    expect(d.patchTab).not.toHaveBeenCalled();
    expect(d.completePanel).not.toHaveBeenCalled();
    expect(d.markPanelClosed).not.toHaveBeenCalled();
  });

  it("is idempotent for duplicate completion events", async () => {
    const d = deps();
    const lifecycle = createTerminalTaskLifecycle(d);

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });
    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledTimes(1);
    expect(d.patchTaskStatus).toHaveBeenCalledTimes(1);
    expect(d.forwardTabPatch).toHaveBeenCalledTimes(1);
  });

  it("resets lifecycle memory when a panel id is reused", async () => {
    const d = deps();
    const lifecycle = createTerminalTaskLifecycle(d);

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    lifecycle.resetPanel("terminal-1", "window-main");

    await lifecycle.completeFromNativeProcessClose({
      browserWindowId: 42,
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });

    expect(d.completePanel).toHaveBeenCalledTimes(2);
    expect(d.patchTaskStatus).toHaveBeenCalledTimes(2);
    expect(d.forwardTabPatch).toHaveBeenCalledTimes(2);
  });
});
