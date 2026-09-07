import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeTerminalProcesses } from "../../../../../src/main/ipc/terminal/process/registry.ts";
import { createTransferCompensation } from "../../../../../src/main/services/panel-transfer/terminal-compensation.ts";
import type { AppWindow } from "../../../../../src/main/windows/app-window.ts";

function fakeWin(id: number): AppWindow {
  return {
    id,
    appView: null,
    close: vi.fn(),
    destroy: vi.fn(),
    focus: vi.fn(),
    getNativeWindowHandle: () => Buffer.from(`handle-${id}`),
    getTitle: vi.fn(() => ""),
    host: {} as AppWindow["host"],
    isDestroyed: () => false,
    isFocused: () => true,
    isMinimized: () => false,
    moveTop: vi.fn(),
    restore: vi.fn(),
    setBackgroundColor: vi.fn(),
    setTitle: vi.fn(),
    webContents: {} as AppWindow["webContents"],
  };
}

describe("terminal transfer compensation", () => {
  afterEach(() => {
    const process = nativeTerminalProcesses.get("22::xfer-panel");
    if (process) nativeTerminalProcesses.closed(process);
    const source = nativeTerminalProcesses.get("11::xfer-panel");
    if (source) nativeTerminalProcesses.closed(source);
  });

  it("clears transferring on the live process when native reverse stays on the target", async () => {
    const process = nativeTerminalProcesses.begin("22::xfer-panel");
    nativeTerminalProcesses.created(process);
    nativeTerminalProcesses.setTransferring(process, true);
    const { reverseCompleted } = createTransferCompensation(
      {
        focusCoordinator: {
          surfaceCreated: vi.fn(),
          surfaceWillClose: vi.fn(),
        } as never,
        foreground: {
          runSerial: async (op) => await op(),
          transferScopes: vi.fn(),
        },
        getAddon: () =>
          ({
            moveTerminal: () => false,
            requestTerminalPresentation: () => 1,
          }) as never,
        getTaskLifecycle: () => null,
        getTaskOutputBindings: () => null,
        getTaskService: () => null,
        resolveWindow: (runtimeWindowId) => {
          if (runtimeWindowId === "source")
            return { recordId: "source-record", win: fakeWin(11) };
          if (runtimeWindowId === "target")
            return { recordId: "target-record", win: fakeWin(22) };
          return null;
        },
      },
      (browserWindowId, panelId) => `${browserWindowId}::${panelId}`
    );

    await reverseCompleted({
      completed: ["native"],
      lifecycleId: "life-1",
      panelId: "xfer-panel",
      phase: "moving",
      sessionToken: null,
      sourceElectronWindowId: "11",
      sourcePresentationId: 1,
      sourceRecordId: "source-record",
      sourceRuntimeWindowId: "source",
      targetElectronWindowId: "22",
      targetPresentationId: 2,
      targetRecordId: "target-record",
      targetRuntimeWindowId: "target",
      transferId: "t-stuck",
    });

    expect(process.transferring).toBe(false);
    expect(nativeTerminalProcesses.inputGuard("22::xfer-panel")()).toBe(true);
  });
});
