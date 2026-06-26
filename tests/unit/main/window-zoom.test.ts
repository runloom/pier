import { createWindowZoomController } from "@main/windows/window-zoom.ts";
import { describe, expect, it, vi } from "vitest";

function createWindow(levels: number[]) {
  return {
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
      setZoomLevel: vi.fn((level: number) => {
        levels.push(level);
      }),
    },
  };
}

describe("window zoom controller", () => {
  it("applies persisted zoom to every live window", async () => {
    const levels: number[] = [];
    const windows = [createWindow(levels), createWindow(levels)];
    const controller = createWindowZoomController({
      listWindows: () => windows,
      readPreferences: vi.fn(async () => ({ windowZoomLevel: 2 })),
      updatePreferences: vi.fn(),
    });

    await controller.applyPersistedZoom();

    expect(levels).toEqual([2, 2]);
    expect(windows[0]?.webContents.send).toHaveBeenCalledWith(
      "pier:window:layout-pulse",
      { reason: "view-zoom", windowZoomLevel: 2 }
    );
  });

  it("applies persisted zoom to one new window without pulsing existing windows", async () => {
    const levels: number[] = [];
    const existingWindow = createWindow(levels);
    const newWindow = createWindow(levels);
    const controller = createWindowZoomController({
      listWindows: () => [existingWindow, newWindow],
      readPreferences: vi.fn(async () => ({ windowZoomLevel: 2 })),
      updatePreferences: vi.fn(),
    });

    await controller.applyPersistedZoomToWindow(newWindow);

    expect(levels).toEqual([2]);
    expect(existingWindow.webContents.setZoomLevel).not.toHaveBeenCalled();
    expect(existingWindow.webContents.send).not.toHaveBeenCalled();
    expect(newWindow.webContents.send).toHaveBeenCalledWith(
      "pier:window:layout-pulse",
      { reason: "view-zoom", windowZoomLevel: 2 }
    );
  });

  it("clamps zoom changes before persisting and leaves application to preferences events", async () => {
    const levels: number[] = [];
    const updatePreferences = vi.fn(
      async (patch: { windowZoomLevel: number }) => ({
        windowZoomLevel: patch.windowZoomLevel,
      })
    );
    const controller = createWindowZoomController({
      listWindows: () => [createWindow(levels)],
      readPreferences: vi.fn(async () => ({ windowZoomLevel: 5 })),
      updatePreferences,
    });

    await controller.zoomIn();

    expect(updatePreferences).toHaveBeenCalledWith({ windowZoomLevel: 5 });
    expect(levels).toEqual([]);
  });

  it("resets zoom to the default level", async () => {
    const levels: number[] = [];
    const updatePreferences = vi.fn(
      async (patch: { windowZoomLevel: number }) => ({
        windowZoomLevel: patch.windowZoomLevel,
      })
    );
    const controller = createWindowZoomController({
      listWindows: () => [createWindow(levels)],
      readPreferences: vi.fn(async () => ({ windowZoomLevel: 3 })),
      updatePreferences,
    });

    await controller.resetZoom();

    expect(updatePreferences).toHaveBeenCalledWith({ windowZoomLevel: 0 });
    expect(levels).toEqual([]);
  });
});
