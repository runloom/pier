import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearLayout: vi.fn(async () => undefined),
  handle: vi.fn(),
  readLayout: vi.fn(async () => ({ layout: "record" })),
  saveLayout: vi.fn(async () => undefined),
}));

vi.mock("@main/app-core/app-core.ts", () => ({
  appCore: {
    services: {
      workspace: {
        clearLayout: mocks.clearLayout,
        readLayout: mocks.readLayout,
        saveLayout: mocks.saveLayout,
      },
    },
  },
}));

function ipcMainMock() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  mocks.handle.mockImplementation(
    (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }
  );
  return { handle: mocks.handle, handlers };
}

describe("registerWorkspaceIpc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a window record id for layout reads", async () => {
    const { registerWorkspaceIpc } = await import("@main/ipc/workspace.ts");
    const ipcMain = ipcMainMock();

    registerWorkspaceIpc(ipcMain as never);

    await expect(
      ipcMain.handlers.get("pier:workspace:load-layout")?.({})
    ).rejects.toThrow("workspace layout recordId required");
    expect(mocks.readLayout).not.toHaveBeenCalled();
  });

  it("passes the record id through for layout operations", async () => {
    const { registerWorkspaceIpc } = await import("@main/ipc/workspace.ts");
    const ipcMain = ipcMainMock();

    registerWorkspaceIpc(ipcMain as never);

    await expect(
      ipcMain.handlers.get("pier:workspace:load-layout")?.({}, "record-1")
    ).resolves.toEqual({ layout: "record" });
    await ipcMain.handlers.get("pier:workspace:save-layout")?.(
      {},
      { grid: "layout" },
      "record-1"
    );
    await ipcMain.handlers.get("pier:workspace:clear-layout")?.({}, "record-1");

    expect(mocks.readLayout).toHaveBeenCalledWith("record-1");
    expect(mocks.saveLayout).toHaveBeenCalledWith(
      { grid: "layout" },
      "record-1"
    );
    expect(mocks.clearLayout).toHaveBeenCalledWith("record-1");
  });
});
