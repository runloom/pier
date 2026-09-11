import { registerTerminalTaskLifecycleForwarding } from "@main/ipc/terminal/task/lifecycle-wiring.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeTerminalProcesses } from "../../../../../src/main/ipc/terminal/process/registry.ts";

const completeTaskPanelMock = vi.hoisted(() => vi.fn(async () => null));
const forwardToWindowMock = vi.hoisted(() => vi.fn());
const hasAgentPresenceMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("@main/ipc/terminal/debug.ts", () => ({
  recordNativeTerminalRoute: vi.fn(),
}));

vi.mock("@main/ipc/terminal/forwarding.ts", () => ({
  forwardToWindow: forwardToWindowMock,
}));

vi.mock("@main/ipc/terminal/window-scope.ts", () => ({
  terminalSessionScopeFor: () => "session-main",
  windowRecordIdFor: () => "session-main",
}));

vi.mock("@main/ipc/terminal/end-state-broadcast.ts", () => ({
  broadcastAgentEndStateForPanel: vi.fn(),
}));

vi.mock("@main/state/terminal-session-state.ts", () => ({
  patchTerminalPanelAgentStatus: vi.fn(async () => false),
  patchTerminalPanelTab: vi.fn(async () => undefined),
  patchTerminalPanelTaskStatus: vi.fn(async () => false),
  updateTerminalPanelTitle: vi.fn(async () => undefined),
}));

vi.mock("@main/windows/identity.ts", () => ({
  findAppWindowByElectronId: () => ({ id: 42, isDestroyed: () => false }),
  findInternalWindowId: () => "window-main",
}));

vi.mock("@main/ipc/foreground-activity.ts", () => ({
  foregroundActivityService: {
    commandFinished: vi.fn(),
    hasAgentPresence: hasAgentPresenceMock,
    ingestCommandStarted: vi.fn(),
    ptyExited: vi.fn(),
  },
}));

interface NativeAddonCallbackHarness {
  childExited?: (
    id: number,
    panelId: string,
    lifecycleId: string,
    exitCode: number,
    runtimeMs: number
  ) => void;
  commandStarted?: (
    id: number,
    panelId: string,
    lifecycleId: string,
    commandLine: string
  ) => void;
  processClosed?: (
    id: number,
    panelId: string,
    lifecycleId: string,
    processAlive: boolean
  ) => void;
}

const setTerminalRetainAfterExitMock = vi.hoisted(() => vi.fn(() => true));

function addonHarness(callbacks: NativeAddonCallbackHarness) {
  return {
    setChildExitedForwardCallback: vi.fn((cb) => {
      callbacks.childExited = cb;
    }),
    setCommandStartedForwardCallback: vi.fn((cb) => {
      callbacks.commandStarted = cb;
    }),
    setCommandFinishedForwardCallback: vi.fn(),
    setProcessClosedForwardCallback: vi.fn((cb) => {
      callbacks.processClosed = cb;
    }),
    setTitleForwardCallback: vi.fn(),
    setTerminalRetainAfterExit: setTerminalRetainAfterExitMock,
  } as never;
}

function liveProcess(
  nativePanelId: string,
  lifecycleId: string
): ReturnType<typeof nativeTerminalProcesses.begin> {
  const process = nativeTerminalProcesses.begin(nativePanelId, { lifecycleId });
  nativeTerminalProcesses.created(process);
  return process;
}

function register(callbacks: NativeAddonCallbackHarness) {
  return registerTerminalTaskLifecycleForwarding(addonHarness(callbacks), {
    completeTaskPanel: completeTaskPanelMock,
  });
}

describe("explicit close does not auto-close sibling terminals", () => {
  beforeEach(() => {
    completeTaskPanelMock.mockClear();
    forwardToWindowMock.mockReset();
    hasAgentPresenceMock.mockReset();
    hasAgentPresenceMock.mockReturnValue(false);
    setTerminalRetainAfterExitMock.mockReset();
    setTerminalRetainAfterExitMock.mockReturnValue(true);
  });

  it("does not inject end copy or request close for a panel the user is closing", () => {
    const callbacks: NativeAddonCallbackHarness = {};
    const lifecycle = register(callbacks);
    lifecycle.resetPanel(
      "term-child-iso",
      "child-life",
      "window-main",
      "agent"
    );
    const child = liveProcess("42::term-child-iso", "child-life");
    nativeTerminalProcesses.markClosing(child);

    callbacks.childExited?.(42, "42::term-child-iso", "child-life", 0, 40);
    callbacks.processClosed?.(42, "42::term-child-iso", "child-life", false);

    expect(forwardToWindowMock).not.toHaveBeenCalled();
  });

  it("still injects a sibling agent exit and does not close that sibling tab", () => {
    const callbacks: NativeAddonCallbackHarness = {};
    const lifecycle = register(callbacks);
    lifecycle.resetPanel(
      "term-child-iso",
      "child-life",
      "window-main",
      "agent"
    );
    lifecycle.resetPanel(
      "term-parent-iso",
      "parent-life",
      "window-main",
      "agent"
    );
    const child = liveProcess("42::term-child-iso", "child-life");
    liveProcess("42::term-parent-iso", "parent-life");
    nativeTerminalProcesses.markClosing(child);

    callbacks.childExited?.(42, "42::term-child-iso", "child-life", 0, 10);
    callbacks.childExited?.(42, "42::term-parent-iso", "parent-life", 0, 20);
    callbacks.processClosed?.(42, "42::term-parent-iso", "parent-life", false);

    expect(forwardToWindowMock).toHaveBeenCalledTimes(1);
    expect(forwardToWindowMock).toHaveBeenCalledWith(
      42,
      PIER_BROADCAST.TERMINAL_CHILD_EXITED,
      expect.objectContaining({
        panelId: "term-parent-iso",
        lifecycleId: "parent-life",
        endReason: "exited",
      }),
      "pier-child-exited"
    );
    expect(forwardToWindowMock).not.toHaveBeenCalledWith(
      42,
      PIER_BROADCAST.TERMINAL_SURFACE_CLOSE_REQUEST,
      expect.anything(),
      expect.anything()
    );
  });

  it("does not request panel close while stop-and-retain is in progress", () => {
    const callbacks: NativeAddonCallbackHarness = {};
    const lifecycle = register(callbacks);
    lifecycle.resetPanel("term-stop-iso", "stop-life", "window-main", "agent");
    const process = liveProcess("42::term-stop-iso", "stop-life");
    process.stopping = true;

    callbacks.childExited?.(42, "42::term-stop-iso", "stop-life", 143, 80);
    callbacks.processClosed?.(42, "42::term-stop-iso", "stop-life", false);

    expect(forwardToWindowMock).toHaveBeenCalledTimes(1);
    expect(forwardToWindowMock).toHaveBeenCalledWith(
      42,
      PIER_BROADCAST.TERMINAL_CHILD_EXITED,
      expect.objectContaining({
        panelId: "term-stop-iso",
        endReason: "stopped",
      }),
      "pier-child-exited"
    );
  });

  it("does not complete a task from PTY exit while the user is closing the tab", async () => {
    const callbacks: NativeAddonCallbackHarness = {};
    const lifecycle = register(callbacks);
    lifecycle.resetPanel(
      "term-task-close-iso",
      "run-close",
      "window-main",
      "task"
    );
    const process = liveProcess("42::term-task-close-iso", "run-close");
    nativeTerminalProcesses.markClosing(process);

    callbacks.childExited?.(42, "42::term-task-close-iso", "run-close", 143, 8);
    callbacks.processClosed?.(
      42,
      "42::term-task-close-iso",
      "run-close",
      false
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(completeTaskPanelMock).not.toHaveBeenCalled();
    expect(forwardToWindowMock).not.toHaveBeenCalled();
  });

  it("keeps a shell tab that had an OSC-detected agent", () => {
    const callbacks: NativeAddonCallbackHarness = {};
    const lifecycle = register(callbacks);
    const process = liveProcess("42::term-osc-iso", "");
    lifecycle.resetPanel(
      "term-osc-iso",
      process.lifecycleId,
      "window-main",
      "shell"
    );
    callbacks.commandStarted?.(
      42,
      "42::term-osc-iso",
      process.lifecycleId,
      "claude"
    );
    expect(setTerminalRetainAfterExitMock).toHaveBeenCalledWith(
      "42::term-osc-iso",
      process.lifecycleId,
      true
    );
    hasAgentPresenceMock.mockReturnValue(true);

    callbacks.processClosed?.(
      42,
      "42::term-osc-iso",
      process.lifecycleId,
      false
    );

    expect(forwardToWindowMock).not.toHaveBeenCalled();
    expect(hasAgentPresenceMock).toHaveBeenCalledWith("term-osc-iso", "42");
  });

  it("still auto-closes an ordinary shell with no agent presence", () => {
    const callbacks: NativeAddonCallbackHarness = {};
    const lifecycle = register(callbacks);
    const process = liveProcess("42::term-shell-iso", "");
    lifecycle.resetPanel(
      "term-shell-iso",
      process.lifecycleId,
      "window-main",
      "shell"
    );

    callbacks.processClosed?.(
      42,
      "42::term-shell-iso",
      process.lifecycleId,
      false
    );

    expect(forwardToWindowMock).toHaveBeenCalledWith(
      42,
      PIER_BROADCAST.TERMINAL_SURFACE_CLOSE_REQUEST,
      { panelId: "term-shell-iso" },
      "pier-terminal-surface-close"
    );
  });
});
