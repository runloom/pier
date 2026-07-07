import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { DockviewApi } from "dockview-react";
import { FileText } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginPanelCloserForWorkspace } from "@/components/workspace/workspace-host.tsx";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";
import {
  clearPluginPanelsForTests,
  closePanelsByPluginComponent,
  registerPluginPanel,
  setPluginPanelCloser,
} from "@/lib/plugins/plugin-panel-registry.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

vi.mock("@/lib/workspace/panel-activation.ts", () => ({
  activateWorkspacePanel: vi.fn(),
}));
vi.mock("@/lib/workspace/tab-visibility.ts", () => ({
  scheduleRevealDockviewTabByPanelId: vi.fn(),
}));

interface MockPanel {
  api: {
    isActive?: boolean;
    isVisible?: boolean;
    setTitle: ReturnType<typeof vi.fn>;
    updateParameters: ReturnType<typeof vi.fn>;
  };
  id: string;
  title: string;
  view: { contentComponent: string };
}

interface AddPanelOptions {
  component: string;
  id: string;
  params?: Record<string, unknown>;
  position?: unknown;
  title: string;
}

const PANEL_OPEN_CAPABILITY_RE = /panel:open/;
const COMMAND_REGISTER_CAPABILITY_RE = /command:register/;
const INSTANCE_ID_COLLISION_RE = /instance id collision/;
const PANEL_REGISTER_CAPABILITY_RE = /panel:register/;

const terminalPanelContext: PanelContext = {
  contextId: "ctx-terminal",
  cwd: "/repo",
  gitRoot: "/repo",
  projectRootPath: "/repo",
  updatedAt: 123,
};

const testPanelRegistration = {
  component: () => null,
  icon: FileText,
  id: "pier.files.filePanel",
  kind: "web",
  title: "File Panel",
} as const;

const testAction = {
  category: "Test",
  handler: () => undefined,
  id: "pier.files.openSelection",
  surfaces: ["terminal/content"],
  title: () => "Open Selection",
} as const;

function entryWithCapabilities(
  capabilities: readonly PierCapability[]
): PluginRegistryEntry {
  return {
    effectivePermissions: [...capabilities],
    enabled: true,
    manifest: {
      apiVersion: 1,
      commands: [{ id: testAction.id, permissions: [], title: "Open" }],
      dashboardWidgets: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.files",
      name: "Files",
      panels: [
        { id: testPanelRegistration.id, permissions: [], title: "File Panel" },
      ],
      permissions: [...capabilities],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: true, kind: "builtin" },
  };
}

function entryWithPanel(): PluginRegistryEntry {
  return entryWithCapabilities([
    "command:register",
    "panel:register",
    "panel:open",
  ]);
}

function entryWithoutPanelOpen(): PluginRegistryEntry {
  return entryWithCapabilities(["command:register", "panel:register"]);
}

function entryWithoutRegisterCapabilities(): PluginRegistryEntry {
  return entryWithCapabilities(["panel:open"]);
}

function createMockApi(initialPanels: readonly MockPanel[] = []) {
  const panels: MockPanel[] = [...initialPanels];
  const api = {
    activeGroup: null,
    addPanel: vi.fn((options: AddPanelOptions) => {
      panels.push({
        api: {
          setTitle: vi.fn((title: string) => {
            const panel = panels.find((item) => item.id === options.id);
            if (panel) {
              panel.title = title;
            }
          }),
          updateParameters: vi.fn(),
        },
        id: options.id,
        title: options.title,
        view: { contentComponent: options.component },
      });
    }),
    get panels() {
      return panels;
    },
    get totalPanels() {
      return panels.length;
    },
    removePanel: vi.fn((panel: MockPanel) => {
      const index = panels.indexOf(panel);
      if (index >= 0) {
        panels.splice(index, 1);
      }
    }),
  } as unknown as DockviewApi;
  return { api, panels };
}

function mockPanel(id: string, component: string): MockPanel {
  return {
    api: { setTitle: vi.fn(), updateParameters: vi.fn() },
    id,
    title: id,
    view: { contentComponent: component },
  };
}

describe("plugin panel instances", () => {
  afterEach(() => {
    clearPluginPanelsForTests();
    useWorkspaceStore.setState({ api: null });
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    vi.restoreAllMocks();
  });

  it("opens panel instances as new tabs in the current dockview group", () => {
    const { api } = createMockApi();
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      instanceId: "pier.files.untitled:1",
      title: "Untitled-1.md",
    });

    expect(api.addPanel).toHaveBeenCalledWith(
      expect.not.objectContaining({ position: expect.anything() })
    );
  });

  it("opens two dockview panel instances with the same plugin component", () => {
    const { api } = createMockApi();
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      instanceId: "pier.files.untitled:1",
      title: "Untitled-1.md",
    });
    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      instanceId: "pier.files.untitled:2",
      title: "Untitled-2.md",
    });

    const panels = useWorkspaceStore.getState().api?.panels ?? [];
    expect(panels.map((panel) => panel.id)).toContain("pier.files.untitled:1");
    expect(panels.map((panel) => panel.id)).toContain("pier.files.untitled:2");
  });

  it("rejects an instance id collision with a different dockview component", () => {
    const existing = mockPanel("shared-id", "terminal");
    const { api } = createMockApi([existing]);
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    expect(() =>
      context.panels.openInstance({
        componentId: "pier.files.filePanel",
        instanceId: "shared-id",
        params: { source: { kind: "untitled" } },
        title: "Should not apply",
      })
    ).toThrow(INSTANCE_ID_COLLISION_RE);

    expect(existing.api.updateParameters).not.toHaveBeenCalled();
    expect(existing.api.setTitle).not.toHaveBeenCalled();
    expect(api.addPanel).not.toHaveBeenCalled();
    expect(
      usePanelDescriptorStore.getState().descriptors["shared-id"]
    ).toBeUndefined();
  });

  it("focuses an existing instance when instance id already exists", () => {
    const { api } = createMockApi();
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);
    const instanceId = "pier.files.file:test-readme";

    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      context: terminalPanelContext,
      instanceId,
      title: "README.md",
    });
    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      context: terminalPanelContext,
      instanceId,
      params: { revision: 2 },
      title: "README.md",
    });

    expect(
      (useWorkspaceStore.getState().api?.panels ?? []).filter(
        (panel) => panel.id === instanceId
      )
    ).toHaveLength(1);
  });

  it("closes all panel instances for a disabled plugin component", () => {
    const { api } = createMockApi([
      mockPanel("pier.files.untitled:1", "pier.files.filePanel"),
      mockPanel("pier.files.untitled:2", "pier.files.filePanel"),
      mockPanel("welcome-1", "welcome"),
    ]);
    useWorkspaceStore.setState({ api });
    setPluginPanelCloser(createPluginPanelCloserForWorkspace(api));
    registerPluginPanel(testPanelRegistration);

    closePanelsByPluginComponent("pier.files.filePanel");

    expect(
      (useWorkspaceStore.getState().api?.panels ?? []).some(
        (panel) => panel.view.contentComponent === "pier.files.filePanel"
      )
    ).toBe(false);
  });

  it("keeps a valid workspace when closing the last plugin panel", () => {
    const { api } = createMockApi([
      mockPanel("pier.files.untitled:1", "pier.files.filePanel"),
    ]);
    useWorkspaceStore.setState({ api });
    setPluginPanelCloser(createPluginPanelCloserForWorkspace(api));

    closePanelsByPluginComponent("pier.files.filePanel");

    expect(
      useWorkspaceStore
        .getState()
        .api?.panels.some((panel) => panel.view.contentComponent === "welcome")
    ).toBe(true);
  });

  it("requires panel:open for both singleton and instance panel open", () => {
    const context = createRendererPluginContext(entryWithoutPanelOpen());
    expect(() => context.panels.open("pier.files.filePanel")).toThrow(
      PANEL_OPEN_CAPABILITY_RE
    );
    expect(() =>
      context.panels.openInstance({
        componentId: "pier.files.filePanel",
        instanceId: "pier.files.untitled:1",
      })
    ).toThrow(PANEL_OPEN_CAPABILITY_RE);
  });

  it("requires register capabilities for action and panel registration", () => {
    const context = createRendererPluginContext(
      entryWithoutRegisterCapabilities()
    );
    expect(() => context.actions.register(testAction)).toThrow(
      COMMAND_REGISTER_CAPABILITY_RE
    );
    expect(() => context.panels.register(testPanelRegistration)).toThrow(
      PANEL_REGISTER_CAPABILITY_RE
    );
    expect(actionRegistry.get(testAction.id)).toBeUndefined();
  });
});
