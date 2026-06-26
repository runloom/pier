import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("zoom.store", () => {
  let onChanged: ((snapshot: { windowZoomLevel: number }) => void) | null =
    null;

  beforeEach(() => {
    vi.resetModules();
    onChanged = null;
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        preferences: {
          onChanged: vi.fn(
            (cb: (snapshot: { windowZoomLevel: number }) => void) => {
              onChanged = cb;
              return vi.fn();
            }
          ),
          read: vi.fn(async () => ({ windowZoomLevel: 2 })),
          update: vi.fn(async (patch: { windowZoomLevel?: number }) => ({
            windowZoomLevel: patch.windowZoomLevel ?? 0,
          })),
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates persisted zoom and listens for cross-window changes", async () => {
    const { initZoom, useZoomStore } = await import("@/stores/zoom.store.ts");

    await initZoom();
    expect(useZoomStore.getState().windowZoomLevel).toBe(2);

    onChanged?.({ windowZoomLevel: -1 });
    expect(useZoomStore.getState().windowZoomLevel).toBe(-1);
  });

  it("persists clamped zoom changes", async () => {
    const { useZoomStore } = await import("@/stores/zoom.store.ts");

    await useZoomStore.getState().setWindowZoomLevel(9);

    expect(window.pier.preferences.update).toHaveBeenCalledWith({
      windowZoomLevel: 5,
    });
    expect(useZoomStore.getState().windowZoomLevel).toBe(5);
  });

  it("ignores sender broadcasts that repeat the current zoom level", async () => {
    const { initZoom, useZoomStore } = await import("@/stores/zoom.store.ts");
    const seen: number[] = [];

    await initZoom();
    const unsubscribe = useZoomStore.subscribe((state) => {
      seen.push(state.windowZoomLevel);
    });

    await useZoomStore.getState().setWindowZoomLevel(3);
    onChanged?.({ windowZoomLevel: 3 });
    unsubscribe();

    expect(seen).toEqual([3]);
  });
});
