import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAll = vi.fn();
const setNativeChromeColor = vi.fn();
const nativeTheme = vi.hoisted(() => {
  const updated: Array<() => void> = [];
  return {
    emitUpdated: () => {
      for (const listener of updated) {
        listener();
      }
    },
    on: vi.fn((event: string, listener: () => void) => {
      if (event === "updated") {
        updated.push(listener);
      }
    }),
    reset() {
      updated.length = 0;
      this.shouldUseDarkColors = true;
      this.themeSource = "system";
      this.on.mockClear();
    },
    shouldUseDarkColors: true,
    themeSource: "system" as "dark" | "light" | "system",
  };
});

vi.mock("electron", () => ({
  nativeTheme,
}));

vi.mock("@main/windows/manager.ts", () => ({
  windowManager: {
    getAll: () => getAll(),
    setNativeChromeColor,
  },
}));

type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

async function setupThemeIpc() {
  const handlers = new Map<string, InvokeHandler>();
  const ipcMain = {
    handle: (channel: string, handler: InvokeHandler) => {
      handlers.set(channel, handler);
    },
  } as unknown as IpcMain;
  const { PIER } = await import("@shared/ipc-channels.ts");
  const { registerThemeIpc } = await import("@main/ipc/theme.ts");
  registerThemeIpc(ipcMain);
  const setNativeChrome = handlers.get(PIER.THEME_SET_NATIVE_CHROME);
  if (!setNativeChrome) {
    throw new Error("set-native-chrome handler missing");
  }
  return { setNativeChrome };
}

describe("theme native chrome IPC", () => {
  beforeEach(() => {
    vi.resetModules();
    nativeTheme.reset();
    getAll.mockReset();
    setNativeChromeColor.mockReset();
    getAll.mockReturnValue([
      {
        setBackgroundColor: vi.fn(),
        webContents: { id: 1, isDestroyed: () => false, send: vi.fn() },
      },
    ]);
  });

  it("writes system to nativeTheme.themeSource instead of the resolved mode", async () => {
    nativeTheme.themeSource = "dark";
    const { setNativeChrome } = await setupThemeIpc();
    setNativeChrome({} as IpcMainInvokeEvent, "system", "#111111");
    expect(nativeTheme.themeSource).toBe("system");
  });

  it("pins nativeTheme when the preference is explicitly dark", async () => {
    const { setNativeChrome } = await setupThemeIpc();
    setNativeChrome({} as IpcMainInvokeEvent, "dark", "#111111");
    expect(nativeTheme.themeSource).toBe("dark");
  });

  it("ignores an invalid themeSource without changing nativeTheme", async () => {
    nativeTheme.themeSource = "system";
    const { setNativeChrome } = await setupThemeIpc();
    setNativeChrome({} as IpcMainInvokeEvent, "dim", "#111111");
    expect(nativeTheme.themeSource).toBe("system");
  });

  it("broadcasts nativeTheme.updated to every live window", async () => {
    const sendA = vi.fn();
    const sendB = vi.fn();
    const sendDestroyed = vi.fn();
    getAll.mockReturnValue([
      {
        webContents: { id: 1, isDestroyed: () => false, send: sendA },
      },
      {
        webContents: { id: 2, isDestroyed: () => false, send: sendB },
      },
      {
        webContents: { id: 3, isDestroyed: () => true, send: sendDestroyed },
      },
    ]);
    nativeTheme.shouldUseDarkColors = false;
    await setupThemeIpc();
    const { PIER_BROADCAST } = await import("@shared/ipc-channels.ts");
    nativeTheme.emitUpdated();
    expect(sendA).toHaveBeenCalledWith(PIER_BROADCAST.THEME_SYSTEM_APPEARANCE, {
      shouldUseDarkColors: false,
    });
    expect(sendB).toHaveBeenCalledWith(PIER_BROADCAST.THEME_SYSTEM_APPEARANCE, {
      shouldUseDarkColors: false,
    });
    expect(sendDestroyed).not.toHaveBeenCalled();
  });
});
