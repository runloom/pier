import type { PanelContext } from "@shared/contracts/panel.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { registerRunActions } from "@/lib/actions/run-actions.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

function context(path: string): PanelContext {
  return {
    contextId: `ctx:${path}`,
    cwd: path,
    openedPath: path,
    projectRoot: path,
    source: "panel",
    updatedAt: 1_772_000_000_000,
    worktreeKey: path,
  };
}

function panel(id: string, component = "terminal") {
  return {
    api: { setActive: vi.fn() },
    id,
    title: "Terminal",
    view: { contentComponent: component },
  };
}

function installWorkspaceApi() {
  const terminalCurrent = panel("terminal-current");
  const terminalOther = panel("terminal-other");
  const welcome = panel("welcome-1", "welcome");
  const api = {
    activePanel: terminalCurrent,
    groups: [
      { panels: [terminalCurrent, terminalOther] },
      { panels: [welcome] },
    ],
    panels: [terminalCurrent, terminalOther, welcome],
  };
  useWorkspaceStore.getState().setApi(api as never);
  usePanelDescriptorStore.setState({
    activeId: "terminal-current",
    descriptors: {
      "terminal-current": {
        context: context("/Users/xyz/ABC/pier"),
        display: { short: "pier" },
      },
      "terminal-other": {
        context: context("/Users/xyz/ABC/loomdesk"),
        display: { short: "loomdesk" },
      },
      "welcome-1": { display: { short: "Welcome" } },
    },
  });
  return { api, terminalCurrent, terminalOther };
}

describe("run actions", () => {
  let disposeRunActions: (() => void) | null = null;

  beforeEach(async () => {
    await initI18n();
    vi.restoreAllMocks();
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    useWorkspaceStore.getState().setApi(null);
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {},
      },
    });
  });

  afterEach(() => {
    disposeRunActions?.();
    disposeRunActions = null;
    useWorkspaceStore.getState().setApi(null);
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    vi.restoreAllMocks();
  });

  it("opens a grouped terminal list from the current workspace panels", async () => {
    installWorkspaceApi();
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.terminalList")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    expect(quickPick?.title).toBe("Terminal List...");
    expect(quickPick?.sections?.map((section) => section.heading)).toEqual([
      "Window 1 · Current Window · Group 1",
    ]);
    expect(quickPick?.sections?.[0]?.items.map((item) => item.label)).toEqual([
      "pier",
      "loomdesk",
    ]);
    expect(quickPick?.sections?.[0]?.items[0]?.checked).toBe(true);
    expect(quickPick?.sections?.[0]?.items[0]?.badges).toEqual([
      { label: "Tab 1/2", variant: "outline" },
    ]);
    expect(quickPick?.sections?.[0]?.items[1]?.badges).toEqual([
      { label: "Tab 2/2", variant: "outline" },
    ]);
    expect(quickPick?.items).toBeUndefined();
  });

  it("focuses an existing terminal from the terminal list", async () => {
    const { terminalOther } = installWorkspaceApi();
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.terminalList")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const target = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "panel:terminal-other");
    if (!(quickPick && target)) {
      throw new Error("expected terminal item");
    }

    await quickPick.onAccept(target);

    expect(terminalOther.api.setActive).toHaveBeenCalledOnce();
  });

  it("renders an empty state when no terminal panels exist", async () => {
    const welcome = panel("welcome-1", "welcome");
    useWorkspaceStore.getState().setApi({
      activePanel: welcome,
      groups: [{ panels: [welcome] }],
      panels: [welcome],
    } as never);
    disposeRunActions = registerRunActions();

    await actionRegistry.get("pier.run.terminalList")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    expect(quickPick?.items?.[0]).toMatchObject({
      disabled: true,
      id: "terminal-empty",
      label: "No terminals available",
    });
  });
});
