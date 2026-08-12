import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const ipcMocks = vi.hoisted(() => ({
  closeCurrentWindow: vi.fn(async () => undefined),
  createWindow: vi.fn(async () => ({
    recordId: "record-new",
    windowId: "w-1",
  })),
  prepareTabStrip: vi.fn(),
}));

vi.mock("@/lib/ipc/window-ipc.ts", () => ({
  closeCurrentWindow: ipcMocks.closeCurrentWindow,
  createWindow: ipcMocks.createWindow,
}));

vi.mock("@/lib/workspace/tab-strip-scroll.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/workspace/tab-strip-scroll.ts")
    >();
  return {
    ...actual,
    prepareTabStripScrollsForMaximizeLayoutMutation: ipcMocks.prepareTabStrip,
  };
});

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
    ipcMocks.prepareTabStrip.mockClear();
    useWorkspaceStore.getState().setApi(null);
  });

  it("registers maximize on the command palette only, not context menus", async () => {
    const { registerPanelActions } = await import(
      "@/lib/actions/panel-actions.ts"
    );
    const panel = activePanel();
    useWorkspaceStore.getState().setApi({
      activePanel: panel,
      // toggleMaximized is gated on workspace.groupCount > 1
      groups: [
        { id: "g1", panels: [panel] },
        { id: "g2", panels: [] },
      ],
    } as never);

    const dispose = registerPanelActions();
    try {
      const action = actionRegistry.get("pier.panel.toggleMaximized");

      expect(action).toBeDefined();
      expect(action?.surfaces).toEqual(["command-palette"]);
      expect(action?.enabled?.()).toBe(true);

      action?.handler();

      expect(ipcMocks.prepareTabStrip).toHaveBeenCalledOnce();
      expect(panel.api.maximize).toHaveBeenCalledOnce();
      // Snapshot must run before dockview mutates visibility.
      expect(ipcMocks.prepareTabStrip.mock.invocationCallOrder[0]).toBeLessThan(
        panel.api.maximize.mock.invocationCallOrder[0] ??
          Number.POSITIVE_INFINITY
      );
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
      expect(action?.surfaces).toEqual(["panel/layout", "command-palette"]);
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
