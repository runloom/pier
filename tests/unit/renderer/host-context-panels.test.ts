import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { DockviewApi } from "dockview-react";
import { House } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";
import {
  clearPluginPanelsForTests,
  getPluginPanelRegistrations,
} from "@/lib/plugins/plugin-panel-registry.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("@/lib/workspace/panel-activation.ts", () => ({
  activateWorkspacePanel: vi.fn(),
}));
vi.mock("@/lib/workspace/tab-visibility.ts", () => ({
  scheduleRevealDockviewTabByPanelId: vi.fn(),
}));

const { activateWorkspacePanel } = await import(
  "@/lib/workspace/panel-activation.ts"
);
const { scheduleRevealDockviewTabByPanelId } = await import(
  "@/lib/workspace/tab-visibility.ts"
);

function entryWithPanel(): PluginRegistryEntry {
  return {
    effectivePermissions: ["panel:register", "panel:open"],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.test",
      name: "Test",
      panels: [{ id: "pier.test.panel", permissions: [], title: "Test" }],
      permissions: ["panel:register", "panel:open"],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

const undeclaredContributionErrorPattern = /not declared/;

const panelReg = {
  component: () => null,
  icon: House,
  id: "pier.test.panel",
  kind: "web",
} as const;

function mockApi(existingPanelIds: readonly string[] = []) {
  const addPanel = vi.fn();
  const api = {
    addPanel,
    panels: existingPanelIds.map((id) => ({
      api: { updateParameters: vi.fn() },
      id,
    })),
  } as unknown as DockviewApi;
  return { addPanel, api };
}

describe("host-context panels", () => {
  afterEach(() => {
    clearPluginPanelsForTests();
    vi.mocked(activateWorkspacePanel).mockReset();
    vi.mocked(scheduleRevealDockviewTabByPanelId).mockReset();
    useWorkspaceStore.setState({ api: null });
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    vi.restoreAllMocks();
  });

  it("register writes to the plugin panel registry", () => {
    const ctx = createRendererPluginContext(entryWithPanel());
    ctx.panels.register(panelReg);
    expect(getPluginPanelRegistrations().get("pier.test.panel")).toBe(panelReg);
  });

  it("register throws when panel id is not declared in manifest", () => {
    const ctx = createRendererPluginContext(entryWithPanel());
    expect(() =>
      ctx.panels.register({ ...panelReg, id: "pier.test.undeclared" })
    ).toThrow(undeclaredContributionErrorPattern);
  });

  it("open is a no-op when workspace api is absent", () => {
    useWorkspaceStore.setState({ api: null });
    const ctx = createRendererPluginContext(entryWithPanel());
    expect(() => ctx.panels.open("pier.test.panel")).not.toThrow();
  });

  it("open throws when panel id is not declared in manifest", () => {
    const ctx = createRendererPluginContext(entryWithPanel());
    expect(() => ctx.panels.open("pier.test.undeclared")).toThrow(
      undeclaredContributionErrorPattern
    );
  });

  it("open adds a new dockview panel when none exists, using thunk title", () => {
    const { addPanel, api } = mockApi();
    useWorkspaceStore.setState({ api });
    const ctx = createRendererPluginContext(entryWithPanel());
    ctx.panels.register({
      ...panelReg,
      title: () => "Localized Title",
    });

    ctx.panels.open("pier.test.panel");

    expect(addPanel).toHaveBeenCalledWith({
      component: "pier.test.panel",
      id: "pier.test.panel",
      position: { direction: "right" },
      title: "Localized Title",
    });
    expect(scheduleRevealDockviewTabByPanelId).toHaveBeenCalledWith(
      "pier.test.panel"
    );
    expect(activateWorkspacePanel).not.toHaveBeenCalled();
  });

  it("open without a source context preserves the panel's stored context", () => {
    const storedContext: PanelContext = {
      contextId: "ctx-1",
      gitRoot: "/repo",
      projectRootPath: "/repo",
      updatedAt: 1,
    };
    usePanelDescriptorStore.getState().upsert("pier.test.panel", {
      context: storedContext,
      display: { short: "Test" },
    });
    const { api } = mockApi(["pier.test.panel"]);
    useWorkspaceStore.setState({ api });
    const ctx = createRendererPluginContext(entryWithPanel());

    ctx.panels.open("pier.test.panel");

    expect(
      usePanelDescriptorStore.getState().descriptors["pier.test.panel"]?.context
    ).toEqual(storedContext);
  });

  it("open with a source context replaces the panel's stored context", () => {
    usePanelDescriptorStore.getState().upsert("pier.test.panel", {
      context: {
        contextId: "ctx-old",
        gitRoot: "/old",
        projectRootPath: "/old",
        updatedAt: 1,
      },
      display: { short: "Test" },
    });
    const { api } = mockApi(["pier.test.panel"]);
    useWorkspaceStore.setState({ api });
    const ctx = createRendererPluginContext(entryWithPanel());
    const nextContext: PanelContext = {
      contextId: "ctx-new",
      gitRoot: "/new",
      projectRootPath: "/new",
      updatedAt: 2,
    };

    ctx.panels.open("pier.test.panel", { context: nextContext });

    expect(
      usePanelDescriptorStore.getState().descriptors["pier.test.panel"]?.context
    ).toEqual(nextContext);
  });

  it("open activates an existing panel instead of creating a duplicate", () => {
    const { addPanel, api } = mockApi(["pier.test.panel"]);
    useWorkspaceStore.setState({ api });
    const ctx = createRendererPluginContext(entryWithPanel());

    ctx.panels.open("pier.test.panel");

    expect(activateWorkspacePanel).toHaveBeenCalledWith(
      api,
      "pier.test.panel",
      {
        reveal: "always",
      }
    );
    expect(addPanel).not.toHaveBeenCalled();
    expect(scheduleRevealDockviewTabByPanelId).not.toHaveBeenCalled();
  });
});
