import type { MenuItemConstructorOptions, PopupOptions } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  let popupCallback: (() => void) | undefined;
  let template: MenuItemConstructorOptions[] = [];
  return {
    buildFromTemplate: vi.fn((nextTemplate: MenuItemConstructorOptions[]) => {
      template = nextTemplate;
      return {
        popup: vi.fn((options: PopupOptions) => {
          popupCallback = options.callback;
        }),
      };
    }),
    close(): void {
      popupCallback?.();
    },
    item(index = 0): MenuItemConstructorOptions | undefined {
      return template[index];
    },
    reset(): void {
      popupCallback = undefined;
      template = [];
    },
  };
});

vi.mock("electron", () => ({
  Menu: { buildFromTemplate: electronMock.buildFromTemplate },
}));

vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    fromWebContents: vi.fn(() => ({ host: {} })),
  },
}));

import { registerMenuIpc } from "@main/ipc/menu.ts";

function harness() {
  let handler:
    | ((
        event: { sender: object },
        template: unknown,
        options: unknown
      ) => Promise<{ actionId: string | null }>)
    | undefined;
  const ipcMain = {
    handle: vi.fn((_channel: string, nextHandler: typeof handler) => {
      handler = nextHandler;
    }),
  };
  registerMenuIpc(ipcMain as never);
  if (!handler) {
    throw new Error("menu IPC handler was not registered");
  }
  return handler;
}

function openMenu(
  handler: ReturnType<typeof harness>
): Promise<{ actionId: string | null }> {
  return handler(
    { sender: {} },
    [
      {
        enabled: true,
        id: "pier.run.rerunTask",
        label: "重新运行",
        type: "action",
      },
    ],
    { x: 10, y: 20 }
  );
}

describe("menu popup IPC", () => {
  beforeEach(() => {
    electronMock.reset();
    vi.clearAllMocks();
  });

  it("returns the selected action only after the native menu closes", async () => {
    const result = openMenu(harness());
    let resolved = false;
    result.then(() => {
      resolved = true;
    });

    electronMock
      .item()
      ?.click?.(undefined as never, undefined as never, undefined as never);
    await Promise.resolve();

    expect(resolved).toBe(false);

    electronMock.close();

    await expect(result).resolves.toEqual({
      actionId: "pier.run.rerunTask",
    });
  });

  it("returns null when the menu closes without a selection", async () => {
    const result = openMenu(harness());

    electronMock.close();

    await expect(result).resolves.toEqual({ actionId: null });
  });

  it("keeps a late selection when the platform reports close before click", async () => {
    const result = openMenu(harness());

    electronMock.close();
    electronMock
      .item()
      ?.click?.(undefined as never, undefined as never, undefined as never);

    await expect(result).resolves.toEqual({
      actionId: "pier.run.rerunTask",
    });
  });
});
