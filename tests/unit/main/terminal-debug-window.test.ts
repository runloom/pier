import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const instances: Array<{
    loadFile: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    showInactive: ReturnType<typeof vi.fn>;
  }> = [];
  const targetWindow = {
    getNativeWindowHandle: vi.fn(() => Buffer.from("window")),
    id: 17,
  };

  return {
    BrowserWindow: vi.fn(function BrowserWindow() {
      const instance = {
        loadFile: vi.fn(async () => undefined),
        loadURL: vi.fn(async () => undefined),
        on: vi.fn(() => instance),
        once: vi.fn(() => instance),
        showInactive: vi.fn(),
      };
      instances.push(instance);
      return instance;
    }),
    instances,
    targetWindow,
  };
});

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
  BrowserWindow: electronMock.BrowserWindow,
}));

vi.mock("@main/ipc/terminal.ts", () => ({
  windowFromWebContents: vi.fn(() => electronMock.targetWindow),
}));

describe("terminal debug window IPC", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    electronMock.instances.length = 0;
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://127.0.0.1:5173");
  });

  it("retains debug windows until they are closed", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, handler);
        }
      ),
    };
    const { registerTerminalDebugWindowIpc } = await import(
      "@main/ipc/terminal-debug-window.ts"
    );

    registerTerminalDebugWindowIpc(ipcMain as never);
    const result = handlers.get("pier:terminal-debug:open-window")?.({
      sender: {},
    });

    expect(result).toEqual({ ok: true, targetBrowserWindowId: 17 });
    expect(electronMock.instances[0]?.on).toHaveBeenCalledWith(
      "closed",
      expect.any(Function)
    );
  });
});
