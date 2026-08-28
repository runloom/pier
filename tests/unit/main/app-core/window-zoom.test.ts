import { createWindowZoomController } from "@main/windows/zoom.ts";
import { describe, expect, it, vi } from "vitest";

function createWindow(levels: number[]) {
  return {
    webContents: {
      isDestroyed: vi.fn(() => false),
      on: vi.fn(),
      send: vi.fn(),
      setVisualZoomLevelLimits: vi.fn(async () => undefined),
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

  it("locks Chromium pinch zoom to the persisted window zoom level", async () => {
    const window = createWindow([]);
    const controller = createWindowZoomController({
      listWindows: () => [window],
      readPreferences: vi.fn(async () => ({ windowZoomLevel: 2 })),
      updatePreferences: vi.fn(),
    });

    await controller.applyPersistedZoomToWindow(window);

    expect(window.webContents.setVisualZoomLevelLimits).toHaveBeenCalledWith(
      1,
      1
    );
  });

  it("restores persisted zoom when Chromium emits wheel zoom-changed", async () => {
    const levels: number[] = [];
    const window = createWindow(levels);
    const updatePreferences = vi.fn();
    const controller = createWindowZoomController({
      listWindows: () => [window],
      readPreferences: vi.fn(async () => ({ windowZoomLevel: 1 })),
      updatePreferences,
    });

    await controller.applyPersistedZoomToWindow(window);

    const listener = vi
      .mocked(window.webContents.on)
      .mock.calls.find(([event]) => event === "zoom-changed")?.[1] as
      | ((event: unknown, direction: "in" | "out") => void)
      | undefined;
    expect(listener).toEqual(expect.any(Function));
    listener?.({}, "in");

    expect(updatePreferences).not.toHaveBeenCalled();
    expect(levels).toEqual([1, 1]);
  });
});
