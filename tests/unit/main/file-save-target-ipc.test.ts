import type { FileSaveTarget } from "@shared/contracts/file-save-target.ts";
import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dialogMock = vi.hoisted(() => vi.fn());
const fromWebContentsMock = vi.hoisted(() => vi.fn());
const findInternalIdMock = vi.hoisted(() => vi.fn());
const findWindowContextMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  dialog: { showSaveDialog: dialogMock },
}));

vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    findInternalIdByWindow: findInternalIdMock,
    fromWebContents: fromWebContentsMock,
  },
}));

vi.mock("@main/windows/window-identity.ts", () => ({
  findWindowContext: findWindowContextMock,
}));

import { registerFileSaveTargetIpc } from "@main/ipc/file-save-target.ts";

const panelContext = {
  contextId: "ctx:repo",
  projectRootPath: "/repo",
  updatedAt: 1,
};

interface SenderStub {
  isDestroyed(): boolean;
}

type SaveTargetHandler = (
  event: { sender: SenderStub },
  payload: unknown
) => Promise<unknown>;

function createHarness(
  dependencies: Parameters<typeof registerFileSaveTargetIpc>[1] = {}
) {
  let senderDestroyed = false;
  let windowDestroyed = false;
  const sender = {
    isDestroyed: () => senderDestroyed,
  };
  const host = { id: "native-window" };
  const window = {
    host,
    isDestroyed: () => windowDestroyed,
    webContents: sender,
  };
  fromWebContentsMock.mockReturnValue(window);
  findInternalIdMock.mockReturnValue("main");
  findWindowContextMock.mockReturnValue({
    mode: "restore",
    recordId: "record-main",
    windowId: "main",
  });

  const handlers = new Map<string, SaveTargetHandler>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: SaveTargetHandler) => {
      handlers.set(channel, handler);
    }),
  };
  registerFileSaveTargetIpc(ipcMain as never, dependencies);
  const handler = handlers.get(PIER.FILE_PICK_SAVE_TARGET);
  if (!handler) {
    throw new Error("expected file save target handler");
  }
  return {
    destroySender: () => {
      senderDestroyed = true;
    },
    destroyWindow: () => {
      windowDestroyed = true;
    },
    handler,
    host,
    sender,
    window,
  };
}

describe("registerFileSaveTargetIpc", () => {
  beforeEach(() => {
    dialogMock.mockReset();
    fromWebContentsMock.mockReset();
    findInternalIdMock.mockReset();
    findWindowContextMock.mockReset();
  });

  it("opens a window-modal native dialog and returns a validated recoverable target", async () => {
    const target: FileSaveTarget = {
      context: panelContext,
      path: "src/notes.md",
      root: "/repo",
    };
    const showSaveDialog = vi.fn(async () => ({
      canceled: false,
      filePath: "/repo/src/notes.md",
    }));
    const resolveSaveTarget = vi.fn(async () => target);
    const harness = createHarness({ resolveSaveTarget, showSaveDialog });

    await expect(
      harness.handler(
        { sender: harness.sender },
        { context: panelContext, suggestedName: "notes.md" }
      )
    ).resolves.toEqual(target);
    expect(showSaveDialog).toHaveBeenCalledWith(harness.window, {
      defaultPath: "/repo/notes.md",
    });
    expect(resolveSaveTarget).toHaveBeenCalledWith(
      "/repo/src/notes.md",
      panelContext
    );
  });

  it("returns null on cancel without resolving a filesystem target", async () => {
    const resolveSaveTarget = vi.fn();
    const harness = createHarness({
      resolveSaveTarget,
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: "" })),
    });

    await expect(
      harness.handler({ sender: harness.sender }, { context: panelContext })
    ).resolves.toBeNull();
    expect(resolveSaveTarget).not.toHaveBeenCalled();
  });

  it("uses the AppWindow host with the production dialog adapter", async () => {
    dialogMock.mockResolvedValue({ canceled: true, filePath: "" });
    const harness = createHarness();

    await expect(
      harness.handler({ sender: harness.sender }, { context: panelContext })
    ).resolves.toBeNull();
    expect(dialogMock).toHaveBeenCalledWith(harness.host, {
      defaultPath: "/repo",
    });
  });

  it.each([
    { context: panelContext, forged: true },
    { context: { ...panelContext, projectId: "forged" } },
    { context: panelContext, suggestedName: "../notes.md" },
    { context: { ...panelContext, projectRootPath: "relative/repo" } },
  ])("rejects invalid or forged payloads", async (payload) => {
    const showSaveDialog = vi.fn();
    const harness = createHarness({ showSaveDialog });

    await expect(
      harness.handler({ sender: harness.sender }, payload)
    ).rejects.toThrow();
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it("rejects a sender that does not belong to a Pier desktop window", async () => {
    const harness = createHarness();
    fromWebContentsMock.mockReturnValue(null);

    await expect(
      harness.handler({ sender: harness.sender }, { context: panelContext })
    ).rejects.toThrow("live Pier desktop window");
    expect(dialogMock).not.toHaveBeenCalled();
  });

  it("rejects a destroyed window or sender before opening the dialog", async () => {
    const windowHarness = createHarness();
    windowHarness.destroyWindow();
    await expect(
      windowHarness.handler(
        { sender: windowHarness.sender },
        { context: panelContext }
      )
    ).rejects.toThrow("live Pier desktop window");

    const senderHarness = createHarness();
    senderHarness.destroySender();
    await expect(
      senderHarness.handler(
        { sender: senderHarness.sender },
        { context: panelContext }
      )
    ).rejects.toThrow("live Pier desktop window");
  });

  it("discards the selection when the window is destroyed while the dialog is open", async () => {
    let harness: ReturnType<typeof createHarness>;
    const showSaveDialog = vi.fn(async () => {
      harness.destroyWindow();
      return { canceled: false, filePath: "/repo/notes.md" };
    });
    const resolveSaveTarget = vi.fn();
    harness = createHarness({ resolveSaveTarget, showSaveDialog });

    await expect(
      harness.handler({ sender: harness.sender }, { context: panelContext })
    ).rejects.toThrow("live Pier desktop window");
    expect(resolveSaveTarget).not.toHaveBeenCalled();
  });

  it("rejects malformed resolver output before returning it to preload", async () => {
    const harness = createHarness({
      resolveSaveTarget: vi.fn(async () => ({
        context: panelContext,
        path: "../outside.md",
        root: "/repo",
      })),
      showSaveDialog: vi.fn(async () => ({
        canceled: false,
        filePath: "/repo/notes.md",
      })),
    });

    await expect(
      harness.handler({ sender: harness.sender }, { context: panelContext })
    ).rejects.toThrow();
  });
});
