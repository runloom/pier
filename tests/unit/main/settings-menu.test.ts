import { describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  appFocus: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    focus: electronMock.appFocus,
  },
}));

import {
  createOpenSettingsMenuItem,
  OPEN_SETTINGS_ACCELERATOR,
  OPEN_SETTINGS_CHANNEL,
} from "@main/settings-menu.ts";

describe("settings menu", () => {
  it("builds a native menu item for the standard settings shortcut", () => {
    const item = createOpenSettingsMenuItem(() => null);

    expect(item.label).toBe("Settings...");
    expect(item.accelerator).toBe(OPEN_SETTINGS_ACCELERATOR);
  });

  it("sends the open settings request to the target renderer", () => {
    const win = {
      focus: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      webContents: {
        focus: vi.fn(),
        isDestroyed: () => false,
        send: vi.fn(),
      },
    };
    const item = createOpenSettingsMenuItem(() => win);

    item.click?.(undefined as never, undefined as never, undefined as never);

    if (process.platform === "darwin") {
      expect(electronMock.appFocus).toHaveBeenCalledWith({ steal: true });
    }
    expect(win.focus).toHaveBeenCalled();
    expect(win.webContents.focus).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith(OPEN_SETTINGS_CHANNEL);
  });
});
