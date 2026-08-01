import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAll = vi.fn();

vi.mock("../../../../src/main/windows/manager.ts", () => ({
  windowManager: {
    getAll: () => getAll(),
    setNativeChromeColor: vi.fn(),
  },
}));

describe("broadcastThemeVisualPreview", () => {
  beforeEach(() => {
    getAll.mockReset();
  });

  it("sends visual preview to other windows and skips sender", async () => {
    const { broadcastThemeVisualPreview } = await import(
      "../../../../src/main/ipc/theme.ts"
    );
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
        webContents: {
          id: 3,
          isDestroyed: () => true,
          send: sendDestroyed,
        },
      },
    ]);

    const payload = {
      stylePresetId: "github",
      theme: "light" as const,
    };
    broadcastThemeVisualPreview({ id: 1 } as Electron.WebContents, payload);

    expect(sendA).not.toHaveBeenCalled();
    expect(sendB).toHaveBeenCalledWith(
      PIER_BROADCAST.THEME_VISUAL_PREVIEW,
      payload
    );
    expect(sendDestroyed).not.toHaveBeenCalled();
  });
});
