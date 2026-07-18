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

  it("registers maximize on the command palette only, not context menus", async () => {
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
      expect(action?.surfaces).toEqual(["command-palette"]);
      expect(action?.enabled?.()).toBe(true);

      action?.handler();

      expect(panel.api.maximize).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it("registers equalize as a layout action for menus and the command palette", async () => {
    const { registerPanelActions } = await import(
      "@/lib/actions/panel-actions.ts"
    );
    const equalizeSplits = vi.fn();
    const originalEqualizeSplits = (
      useWorkspaceStore.getState() as {
        equalizeSplits?: () => void;
      }
    ).equalizeSplits;
    useWorkspaceStore.setState({
      api: {
        activePanel: activePanel(),
        groups: [{ id: "group-1" }, { id: "group-2" }],
      } as never,
      equalizeSplits,
    } as never);

    const dispose = registerPanelActions();
    try {
      const action = actionRegistry.get("pier.panel.equalizeSplits");

      expect(action).toBeDefined();
      expect(action?.surfaces).toEqual(["panel/content", "command-palette"]);
      expect(action?.enabled?.()).toBe(true);

      action?.handler();

      expect(equalizeSplits).toHaveBeenCalledOnce();
    } finally {
      dispose();
      useWorkspaceStore.setState({
        equalizeSplits: originalEqualizeSplits,
      } as never);
    }
  });
});
