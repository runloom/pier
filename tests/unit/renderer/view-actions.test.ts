import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { registerViewActions } from "@/lib/actions/view-actions.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

describe("view actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useZoomStore.setState({ windowZoomLevel: 0 });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        preferences: {
          update: vi.fn(async (patch: { windowZoomLevel?: number }) => ({
            windowZoomLevel: patch.windowZoomLevel ?? 0,
          })),
        },
      },
    });
  });

  it("registers zoom actions that update the persisted zoom level", async () => {
    const dispose = registerViewActions();

    await actionRegistry.get("pier.view.zoomIn")?.handler();
    expect(window.pier.preferences.update).toHaveBeenLastCalledWith({
      windowZoomLevel: 1,
    });

    await actionRegistry.get("pier.view.zoomOut")?.handler();
    expect(window.pier.preferences.update).toHaveBeenLastCalledWith({
      windowZoomLevel: 0,
    });

    await actionRegistry.get("pier.view.resetZoom")?.handler();
    expect(window.pier.preferences.update).toHaveBeenLastCalledWith({
      windowZoomLevel: 0,
    });

    dispose();
  });
});
