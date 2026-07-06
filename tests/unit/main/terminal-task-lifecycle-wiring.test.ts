import { registerTerminalTaskLifecycleForwarding } from "@main/ipc/terminal-task-lifecycle-wiring.ts";
import { TASK_EXIT_TITLE_PREFIX } from "@shared/contracts/tasks.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const completeFromNativeProcessCloseMock = vi.hoisted(() => vi.fn());
const completeFromExitCodeHintMock = vi.hoisted(() => vi.fn());
const forwardToWindowMock = vi.hoisted(() => vi.fn());
const recordExitCodeHintMock = vi.hoisted(() => vi.fn());
const recordNativeTerminalRouteMock = vi.hoisted(() => vi.fn());
const resetPanelMock = vi.hoisted(() => vi.fn());
const patchTerminalPanelAgentStatusMock = vi.hoisted(() => vi.fn());
const updateTerminalPanelTitleMock = vi.hoisted(() => vi.fn());

vi.mock("@main/ipc/terminal-debug.ts", () => ({
  recordNativeTerminalRoute: recordNativeTerminalRouteMock,
}));

vi.mock("@main/ipc/terminal-forwarding.ts", () => ({
  forwardToWindow: forwardToWindowMock,
}));

vi.mock("@main/ipc/terminal-task-lifecycle.ts", () => ({
  createTerminalTaskLifecycle: () => ({
    completeFromExitCodeHint: completeFromExitCodeHintMock,
    completeFromNativeProcessClose: completeFromNativeProcessCloseMock,
    recordExitCodeHint: recordExitCodeHintMock,
    resetPanel: resetPanelMock,
  }),
}));

vi.mock("@main/ipc/terminal-window-scope.ts", () => ({
  terminalSessionScopeFor: () => "session-main",
  windowRecordIdFor: () => "session-main",
}));

vi.mock("@main/state/terminal-session-state.ts", () => ({
  patchTerminalPanelAgentStatus: patchTerminalPanelAgentStatusMock,
  patchTerminalPanelTab: vi.fn(),
  patchTerminalPanelTaskStatus: vi.fn(),
  updateTerminalPanelTitle: updateTerminalPanelTitleMock,
}));

vi.mock("@main/windows/window-identity.ts", () => ({
  findAppWindowByElectronId: () => ({ isDestroyed: () => false }),
  findInternalWindowId: () => "window-main",
}));

interface NativeAddonCallbackHarness {
  commandFinished?: (id: number, panelId: string, exitCode: number) => void;
  processClosed?: (id: number, panelId: string, processAlive: boolean) => void;
  title?: (id: number, panelId: string, title: string) => void;
}

function addonHarness(callbacks: NativeAddonCallbackHarness) {
  return {
    setCommandFinishedForwardCallback: vi.fn((cb) => {
      callbacks.commandFinished = cb;
    }),
    setProcessClosedForwardCallback: vi.fn((cb) => {
      callbacks.processClosed = cb;
    }),
    setTitleForwardCallback: vi.fn((cb) => {
      callbacks.title = cb;
    }),
  } as never;
}

describe("terminal task lifecycle wiring", () => {
  beforeEach(() => {
    completeFromExitCodeHintMock.mockReset();
    completeFromNativeProcessCloseMock.mockReset();
    forwardToWindowMock.mockReset();
    recordExitCodeHintMock.mockReset();
    recordNativeTerminalRouteMock.mockReset();
    resetPanelMock.mockReset();
    patchTerminalPanelAgentStatusMock.mockReset();
    patchTerminalPanelAgentStatusMock.mockResolvedValue(false);
    updateTerminalPanelTitleMock.mockReset();
  });

  it("forwards native process-close callbacks into lifecycle finalization", () => {
    const callbacks: NativeAddonCallbackHarness = {};
    completeFromNativeProcessCloseMock.mockResolvedValue(true);
    registerTerminalTaskLifecycleForwarding(addonHarness(callbacks));

    callbacks.processClosed?.(42, "native::terminal-1", false);

    expect(completeFromNativeProcessCloseMock).toHaveBeenCalledWith({
      browserWindowId: 42,
      panelId: "terminal-1",
      processAlive: false,
      windowId: "window-main",
    });
    expect(patchTerminalPanelAgentStatusMock).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      expect.objectContaining({ status: "exited" })
    );
  });

  it("normalizes negative command-finished exit codes before recording hints", () => {
    const callbacks: NativeAddonCallbackHarness = {};
    registerTerminalTaskLifecycleForwarding(addonHarness(callbacks));

    callbacks.commandFinished?.(42, "native::terminal-1", -9);

    expect(recordExitCodeHintMock).toHaveBeenCalledWith({
      browserWindowId: 42,
      code: 1,
      panelId: "terminal-1",
      source: "shell-command-finished",
      windowId: "window-main",
    });
  });

  it("completes known command-finished exit codes before terminal close", () => {
    const callbacks: NativeAddonCallbackHarness = {};
    completeFromExitCodeHintMock.mockResolvedValue(true);
    registerTerminalTaskLifecycleForwarding(addonHarness(callbacks));

    callbacks.commandFinished?.(42, "native::terminal-1", 0);

    expect(completeFromExitCodeHintMock).toHaveBeenCalledWith({
      browserWindowId: 42,
      code: 0,
      panelId: "terminal-1",
      source: "shell-command-finished",
      windowId: "window-main",
    });
    expect(patchTerminalPanelAgentStatusMock).toHaveBeenCalledWith(
      "session-main",
      "terminal-1",
      expect.objectContaining({ exitCode: 0, status: "exited" })
    );
    expect(recordExitCodeHintMock).not.toHaveBeenCalled();
  });

  it("completes task-exit title markers without waiting for terminal close", () => {
    const callbacks: NativeAddonCallbackHarness = {};
    completeFromExitCodeHintMock.mockResolvedValue(true);
    registerTerminalTaskLifecycleForwarding(addonHarness(callbacks));

    callbacks.title?.(42, "native::terminal-1", `${TASK_EXIT_TITLE_PREFIX}-99`);

    expect(completeFromExitCodeHintMock).toHaveBeenCalledWith({
      browserWindowId: 42,
      code: 1,
      panelId: "terminal-1",
      source: "task-exit-marker",
      windowId: "window-main",
    });
    expect(updateTerminalPanelTitleMock).not.toHaveBeenCalled();
    expect(forwardToWindowMock).not.toHaveBeenCalled();
  });
});
