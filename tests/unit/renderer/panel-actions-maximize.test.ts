import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const ipcMocks = vi.hoisted(() => ({
  closeCurrentWindow: vi.fn(async () => undefined),
  createWindow: vi.fn(async () => ({
    recordId: "record-new",
    windowId: "w-1",
  })),
}));

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  closeCurrentWindow: ipcMocks.closeCurrentWindow,
  createWindow: ipcMocks.createWindow,
}));

function activePanel() {
  return {
    api: {
      exitMaximized: vi.fn(),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      setActive: vi.fn(),
    },
    id: "terminal-1",
    title: "Terminal",
    view: { contentComponent: "terminal" },
  };
}

describe("panel maximize action", () => {
  beforeEach(() => {
    useWorkspaceStore.getState().setApi(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.getState().setApi(null);
  });

  it("registers a shortcut-only action that toggles the active panel maximize state", async () => {
    const { registerPanelActions } = await import(
      "@/lib/actions/panel-actions.ts"
    );
    const panel = activePanel();
    useWorkspaceStore.getState().setApi({
      activePanel: panel,
    } as never);

    const dispose = registerPanelActions();
    try {
      const action = actionRegistry.get("pier.panel.toggleMaximized");

      expect(action).toBeDefined();
      expect(action?.surfaces).toEqual([]);
      expect(action?.enabled?.()).toBe(true);

      action?.handler();

      expect(panel.api.maximize).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });
});
