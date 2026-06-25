import { afterEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";

const createWindow = vi.fn(async () => ({
  recordId: "record-new",
  windowId: "w-1",
}));

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  createWindow,
}));

describe("panel window actions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates Cmd+N windows through the public fresh-window entrypoint", async () => {
    const { registerPanelActions } = await import(
      "@/lib/actions/panel-actions.ts"
    );

    const dispose = registerPanelActions();
    try {
      actionRegistry.get("pier.window.newWindow")?.handler();
      await Promise.resolve();

      expect(createWindow).toHaveBeenCalledWith();
    } finally {
      dispose();
    }
  });
});
