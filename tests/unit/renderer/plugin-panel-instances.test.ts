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
import { activateWorkspacePanel } from "@/lib/workspace/panel-activation.ts";
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
    close: ReturnType<typeof vi.fn>;
    isActive?: boolean;
    isVisible?: boolean;
    setTitle: ReturnType<typeof vi.fn>;
    updateParameters: ReturnType<typeof vi.fn>;
  };
  id: string;
  params?: Record<string, unknown>;
  title: string;
  view: { contentComponent: string };
}

interface MockGroup {
  id: string;
  panels: MockPanel[];
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
const PANEL_NOT_DECLARED_RE = /not declared:.*panel:terminal/i;
const TARGET_GROUP_B_MISMATCH_RE = /target group.*group-b/i;
const TARGET_GROUP_MISSING_RE = /target group.*missing-group/i;
const ADD_PANEL_FAILED_RE = /addPanel failed/i;

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
      missionControlWidgets: [],
      settingsPages: [],
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

function createMockApi(
  initialPanels: readonly MockPanel[] = [],
  initialGroups?: readonly MockGroup[],
  options: { activeGroupId?: string | null; throwOnAddPanel?: boolean } = {}
) {
  const groups: MockGroup[] = initialGroups?.map((group) => ({
    id: group.id,
    panels: [...group.panels],
  })) ?? [{ id: "group-1", panels: [...initialPanels] }];

  const ungroupedPanels = initialPanels.filter(
    (panel) => !groups.some((group) => group.panels.includes(panel))
  );

  const allPanels = () => {
    const seen = new Set<string>();
    const result: MockPanel[] = [];
    for (const group of groups) {
      for (const panel of group.panels) {
        if (!seen.has(panel.id)) {
          seen.add(panel.id);
          result.push(panel);
        }
      }
    }
    for (const panel of ungroupedPanels) {
      if (!seen.has(panel.id)) {
        seen.add(panel.id);
        result.push(panel);
      }
    }
    return result;
  };

  const removePanelFromAllGroups = (panel: MockPanel) => {
    for (const group of groups) {
      const index = group.panels.indexOf(panel);
      if (index >= 0) {
        group.panels.splice(index, 1);
      }
    }
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      if (groups[index]?.panels.length === 0) {
        groups.splice(index, 1);
      }
    }
    const ungroupedIndex = ungroupedPanels.indexOf(panel);
    if (ungroupedIndex >= 0) {
      ungroupedPanels.splice(ungroupedIndex, 1);
    }
  };

  for (const panel of initialPanels) {
    panel.api.close.mockImplementation(() => {
      removePanelFromAllGroups(panel);
    });
    panel.api.updateParameters.mockImplementation(
      (params: Record<string, unknown>) => {
        panel.params = params;
      }
    );
    panel.api.setTitle.mockImplementation((title: string) => {
      panel.title = title;
    });
  }

  const api = {
    get activeGroup() {
      if (options.activeGroupId === null) {
        return null;
      }
      if (options.activeGroupId) {
        return (
          groups.find((group) => group.id === options.activeGroupId) ?? null
        );
      }
      return groups[0] ?? null;
    },
    addPanel: vi.fn((addOptions: AddPanelOptions) => {
      if (options.throwOnAddPanel) {
        throw new Error("mock addPanel failed");
      }
      const panel = mockPanel(
        addOptions.id,
        addOptions.component,
        addOptions.params
      );
      panel.title = addOptions.title;
      panel.api.close.mockImplementation(() => {
        removePanelFromAllGroups(panel);
      });
      panel.api.updateParameters.mockImplementation(
        (params: Record<string, unknown>) => {
          panel.params = params;
        }
      );
      panel.api.setTitle.mockImplementation((title: string) => {
        panel.title = title;
      });
      const position = addOptions.position as
        | { referenceGroup?: MockGroup }
        | undefined;
      const fallbackGroup =
        options.activeGroupId && options.activeGroupId !== null
          ? groups.find((group) => group.id === options.activeGroupId)
          : groups[0];
      const targetGroup =
        position?.referenceGroup && groups.includes(position.referenceGroup)
          ? position.referenceGroup
          : fallbackGroup;
      targetGroup?.panels.push(panel);
    }),
    get groups() {
      return groups;
    },
    get panels() {
      return allPanels();
    },
    get totalPanels() {
      return allPanels().length;
    },
    removePanel: vi.fn((panel: MockPanel) => {
      removePanelFromAllGroups(panel);
    }),
  } as unknown as DockviewApi;
  return { api, groups };
}

function mockPanel(
  id: string,
  component: string,
  params?: Record<string, unknown>
): MockPanel {
  return {
    api: { close: vi.fn(), setTitle: vi.fn(), updateParameters: vi.fn() },
    id,
    ...(params ? { params } : {}),
    title: id,
    view: { contentComponent: component },
  };
}

describe("plugin panel instances", () => {
  afterEach(() => {
    clearPluginPanelsForTests();
    useWorkspaceStore.setState({ api: null });
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("listInstances returns declared plugin panel instances with readonly params snapshots", () => {
    const filePanelA = mockPanel("file-a", "pier.files.filePanel", {
      source: { kind: "disk", path: "README.md", root: "/repo" },
    });
    const filePanelB = mockPanel("file-b", "pier.files.filePanel", {
      source: { kind: "disk", path: "NOTES.md", root: "/repo" },
    });
    const terminal = mockPanel("terminal-1", "terminal");
    const { api } = createMockApi(
      [filePanelA, filePanelB, terminal],
      [
        { id: "group-a", panels: [filePanelA, terminal] },
        { id: "group-b", panels: [filePanelB] },
      ]
    );
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    const instances = context.panels.listInstances("pier.files.filePanel");

    expect(instances).toEqual([
      {
        componentId: "pier.files.filePanel",
        groupId: "group-a",
        id: "file-a",
        params: filePanelA.params,
        title: "file-a",
      },
      {
        componentId: "pier.files.filePanel",
        groupId: "group-b",
        id: "file-b",
        params: filePanelB.params,
        title: "file-b",
      },
    ]);
    expect(instances[0]?.params).not.toBe(filePanelA.params);
    const snapshotSource = instances[0]?.params?.source as
      | Record<string, unknown>
      | undefined;
    const originalSource = filePanelA.params?.source as
      | Record<string, unknown>
      | undefined;
    expect(snapshotSource).not.toBe(originalSource);
    if (!(snapshotSource && originalSource)) {
      throw new Error("expected source params");
    }
    snapshotSource.path = "MUTATED.md";
    expect(originalSource.path).toBe("README.md");
  });

  it("rejects listInstances for undeclared panel components", () => {
    const { api } = createMockApi([mockPanel("terminal-1", "terminal")]);
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    expect(() => context.panels.listInstances("terminal")).toThrow(
      PANEL_NOT_DECLARED_RE
    );
  });

  it("listInstances clones cyclic params without leaking live refs", () => {
    const cyclicParams: Record<string, unknown> = { label: "cycle" };
    cyclicParams.self = cyclicParams;
    const filePanel = mockPanel(
      "file-cycle",
      "pier.files.filePanel",
      cyclicParams
    );
    const { api } = createMockApi([filePanel]);
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    const [snapshot] = context.panels.listInstances("pier.files.filePanel");
    const snapshotParams = snapshot?.params as Record<string, unknown>;

    expect(snapshotParams).not.toBe(cyclicParams);
    expect(snapshotParams.self).toBe(snapshotParams);
  });

  it("listInstances clones non-plain params without leaking live refs", () => {
    const params = {
      openedAt: new Date("2026-01-01T00:00:00.000Z"),
      metadata: new Map<string, { count: number }>([
        ["README.md", { count: 1 }],
      ]),
    };
    const filePanel = mockPanel(
      "file-non-plain",
      "pier.files.filePanel",
      params
    );
    const { api } = createMockApi([filePanel]);
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    const [snapshot] = context.panels.listInstances("pier.files.filePanel");
    const snapshotParams = snapshot?.params as
      | {
          metadata?: Map<string, { count: number }>;
          openedAt?: Date;
        }
      | undefined;

    expect(snapshotParams?.openedAt).toBeInstanceOf(Date);
    expect(snapshotParams?.openedAt).not.toBe(params.openedAt);
    snapshotParams?.openedAt?.setUTCFullYear(2030);
    expect(params.openedAt.getUTCFullYear()).toBe(2026);

    expect(snapshotParams?.metadata).toBeInstanceOf(Map);
    expect(snapshotParams?.metadata).not.toBe(params.metadata);
    const snapshotMetadata = snapshotParams?.metadata?.get("README.md");
    const originalMetadata = params.metadata.get("README.md");
    expect(snapshotMetadata).not.toBe(originalMetadata);
    if (!(snapshotMetadata && originalMetadata)) {
      throw new Error("expected map metadata");
    }
    snapshotMetadata.count = 2;
    expect(originalMetadata.count).toBe(1);
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

  it("activates an equivalent existing file instance without updating params", () => {
    const instanceId = "pier.files.filePanel:disk:readme";
    const existingSource = { kind: "disk", path: "README.md", root: "/repo" };
    const nextSource = { kind: "disk", path: "README.md", root: "/repo" };
    const existingContext = { ...terminalPanelContext };
    const nextContext = { ...terminalPanelContext };
    const existing = mockPanel(instanceId, "pier.files.filePanel", {
      context: existingContext,
      pinned: false,
      pluginComponentId: "pier.files.filePanel",
      source: existingSource,
    });
    const { api } = createMockApi([existing]);
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      context: nextContext,
      dropUnpinnedInstances: true,
      instanceId,
      params: {
        pinned: false,
        source: nextSource,
      },
      title: "README.md",
    });

    expect(existing.api.updateParameters).not.toHaveBeenCalled();
    expect(api.addPanel).not.toHaveBeenCalled();
    expect(activateWorkspacePanel).toHaveBeenCalledWith(api, instanceId, {
      reveal: "always",
    });
  });

  it("preserves pinned file params when a later preview open targets the same instance", () => {
    const source = { kind: "disk", path: "README.md", root: "/repo" };
    const instanceId = "pier.files.filePanel:disk:readme";
    const existing = mockPanel(instanceId, "pier.files.filePanel", {
      pinned: true,
      source,
    });
    const { api } = createMockApi([existing]);
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      context: terminalPanelContext,
      dropUnpinnedInstances: true,
      instanceId,
      params: {
        pinned: false,
        source,
      },
      title: "README.md",
    });

    expect(existing.api.updateParameters).toHaveBeenCalledTimes(1);
    expect(existing.api.updateParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        pinned: true,
        source,
      })
    );
    expect(api.addPanel).not.toHaveBeenCalled();
  });

  it("drops unpinned preview instances only inside the target group", () => {
    const previewA = mockPanel("preview-a", "pier.files.filePanel", {
      pinned: false,
    });
    const previewB = mockPanel("preview-b", "pier.files.filePanel", {
      pinned: false,
    });
    const pinnedB = mockPanel("pinned-b", "pier.files.filePanel", {
      pinned: true,
    });
    const { api, groups } = createMockApi(
      [previewA, previewB, pinnedB],
      [
        { id: "group-a", panels: [previewA] },
        { id: "group-b", panels: [previewB, pinnedB] },
      ]
    );
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      dropUnpinnedInstances: true,
      instanceId: "new-preview-b",
      params: { pinned: false },
      targetGroupId: "group-b",
      title: "New.md",
    });

    expect(groups[0]?.panels.map((panel) => panel.id)).toEqual(["preview-a"]);
    expect(groups[1]?.panels.map((panel) => panel.id)).toEqual([
      "pinned-b",
      "new-preview-b",
    ]);
    expect(api.addPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        position: {
          direction: "within",
          referenceGroup: groups[1],
        },
      })
    );
  });

  it("drops previews only in the active group when targetGroupId is omitted", () => {
    const previewA = mockPanel("preview-a", "pier.files.filePanel", {
      pinned: false,
    });
    const previewB = mockPanel("preview-b", "pier.files.filePanel", {
      pinned: false,
    });
    const { api, groups } = createMockApi(
      [previewA, previewB],
      [
        { id: "group-a", panels: [previewA] },
        { id: "group-b", panels: [previewB] },
      ],
      { activeGroupId: "group-b" }
    );
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      dropUnpinnedInstances: true,
      instanceId: "new-preview-b",
      params: { pinned: false },
      title: "New.md",
    });

    expect(groups[0]?.panels.map((panel) => panel.id)).toEqual(["preview-a"]);
    expect(groups[1]?.panels.map((panel) => panel.id)).toEqual([
      "new-preview-b",
    ]);
  });

  it("keeps replacement in a target group when replacing that group's last preview", () => {
    const previewA = mockPanel("preview-a", "pier.files.filePanel", {
      pinned: false,
    });
    const previewB = mockPanel("preview-b", "pier.files.filePanel", {
      pinned: false,
    });
    const { api, groups } = createMockApi(
      [previewA, previewB],
      [
        { id: "group-a", panels: [previewA] },
        { id: "group-b", panels: [previewB] },
      ],
      { activeGroupId: "group-b" }
    );
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      dropUnpinnedInstances: true,
      instanceId: "new-preview-b",
      params: { pinned: false },
      targetGroupId: "group-b",
      title: "New.md",
    });

    expect(groups.map((group) => group.id)).toEqual(["group-a", "group-b"]);
    expect(groups[0]?.panels.map((panel) => panel.id)).toEqual(["preview-a"]);
    expect(groups[1]?.panels.map((panel) => panel.id)).toEqual([
      "new-preview-b",
    ]);
  });

  it("keeps replacement in the active group when replacing that group's last preview", () => {
    const previewA = mockPanel("preview-a", "pier.files.filePanel", {
      pinned: false,
    });
    const previewB = mockPanel("preview-b", "pier.files.filePanel", {
      pinned: false,
    });
    const { api, groups } = createMockApi(
      [previewA, previewB],
      [
        { id: "group-a", panels: [previewA] },
        { id: "group-b", panels: [previewB] },
      ],
      { activeGroupId: "group-b" }
    );
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      dropUnpinnedInstances: true,
      instanceId: "new-preview-b",
      params: { pinned: false },
      title: "New.md",
    });

    expect(groups.map((group) => group.id)).toEqual(["group-a", "group-b"]);
    expect(groups[0]?.panels.map((panel) => panel.id)).toEqual(["preview-a"]);
    expect(groups[1]?.panels.map((panel) => panel.id)).toEqual([
      "new-preview-b",
    ]);
  });

  it("does not drop previews globally when targetGroupId is invalid", () => {
    const previewA = mockPanel("preview-a", "pier.files.filePanel", {
      pinned: false,
    });
    const previewB = mockPanel("preview-b", "pier.files.filePanel", {
      pinned: false,
    });
    const { api, groups } = createMockApi(
      [previewA, previewB],
      [
        { id: "group-a", panels: [previewA] },
        { id: "group-b", panels: [previewB] },
      ]
    );
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      dropUnpinnedInstances: true,
      instanceId: "new-preview",
      params: { pinned: false },
      targetGroupId: "missing-group",
      title: "New.md",
    });

    expect(previewA.api.close).not.toHaveBeenCalled();
    expect(previewB.api.close).not.toHaveBeenCalled();
    expect(groups[0]?.panels.map((panel) => panel.id)).toEqual([
      "preview-a",
      "new-preview",
    ]);
    expect(groups[1]?.panels.map((panel) => panel.id)).toEqual(["preview-b"]);
    expect(api.addPanel).toHaveBeenCalledWith(
      expect.not.objectContaining({ position: expect.anything() })
    );
  });

  it("does not drop previews globally when no active group exists", () => {
    const previewA = mockPanel("preview-a", "pier.files.filePanel", {
      pinned: false,
    });
    const previewB = mockPanel("preview-b", "pier.files.filePanel", {
      pinned: false,
    });
    const { api, groups } = createMockApi(
      [previewA, previewB],
      [
        { id: "group-a", panels: [previewA] },
        { id: "group-b", panels: [previewB] },
      ],
      { activeGroupId: null }
    );
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      dropUnpinnedInstances: true,
      instanceId: "new-preview",
      params: { pinned: false },
      title: "New.md",
    });

    expect(previewA.api.close).not.toHaveBeenCalled();
    expect(previewB.api.close).not.toHaveBeenCalled();
    expect(groups[0]?.panels.map((panel) => panel.id)).toEqual([
      "preview-a",
      "new-preview",
    ]);
    expect(groups[1]?.panels.map((panel) => panel.id)).toEqual(["preview-b"]);
  });

  it("rejects updating an existing instance outside the requested target group", () => {
    const existing = mockPanel("shared-file-instance", "pier.files.filePanel", {
      pinned: true,
      source: { kind: "disk", path: "README.md", root: "/repo" },
    });
    const { api } = createMockApi(
      [existing],
      [
        { id: "group-a", panels: [existing] },
        { id: "group-b", panels: [] },
      ]
    );
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    expect(() =>
      context.panels.openInstance({
        componentId: "pier.files.filePanel",
        instanceId: "shared-file-instance",
        params: { pinned: false },
        targetGroupId: "group-b",
        title: "Should not apply",
      })
    ).toThrow(TARGET_GROUP_B_MISMATCH_RE);

    expect(existing.api.updateParameters).not.toHaveBeenCalled();
    expect(existing.api.setTitle).not.toHaveBeenCalled();
    expect(api.addPanel).not.toHaveBeenCalled();
    expect(activateWorkspacePanel).not.toHaveBeenCalled();
    expect(
      usePanelDescriptorStore.getState().descriptors["shared-file-instance"]
    ).toBeUndefined();
  });

  it("rejects updating an existing instance when the requested target group is missing", () => {
    const existing = mockPanel("shared-file-instance", "pier.files.filePanel", {
      pinned: true,
      source: { kind: "disk", path: "README.md", root: "/repo" },
    });
    const { api } = createMockApi(
      [existing],
      [
        { id: "group-a", panels: [existing] },
        { id: "group-b", panels: [] },
      ]
    );
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    expect(() =>
      context.panels.openInstance({
        componentId: "pier.files.filePanel",
        instanceId: "shared-file-instance",
        params: { pinned: false },
        targetGroupId: "missing-group",
        title: "Should not apply",
      })
    ).toThrow(TARGET_GROUP_MISSING_RE);

    expect(existing.api.updateParameters).not.toHaveBeenCalled();
    expect(existing.api.setTitle).not.toHaveBeenCalled();
    expect(api.addPanel).not.toHaveBeenCalled();
    expect(activateWorkspacePanel).not.toHaveBeenCalled();
    expect(
      usePanelDescriptorStore.getState().descriptors["shared-file-instance"]
    ).toBeUndefined();
  });

  it("does not leave a descriptor when adding a new instance fails", () => {
    const { api } = createMockApi([], undefined, { throwOnAddPanel: true });
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    expect(() =>
      context.panels.openInstance({
        componentId: "pier.files.filePanel",
        instanceId: "new-failing-instance",
        title: "Should not stick",
      })
    ).toThrow(ADD_PANEL_FAILED_RE);

    expect(
      usePanelDescriptorStore.getState().descriptors["new-failing-instance"]
    ).toBeUndefined();
  });

  it("updates existing params when non-plain object params are different references", () => {
    const existing = mockPanel("file-with-date", "pier.files.filePanel", {
      metadata: new Date("2026-01-01T00:00:00.000Z"),
      pluginComponentId: "pier.files.filePanel",
    });
    const { api } = createMockApi([existing]);
    useWorkspaceStore.setState({ api });
    const context = createRendererPluginContext(entryWithPanel());
    context.panels.register(testPanelRegistration);

    context.panels.openInstance({
      componentId: "pier.files.filePanel",
      instanceId: "file-with-date",
      params: { metadata: new Date("2026-01-01T00:00:00.000Z") },
      title: "Date.md",
    });

    expect(existing.api.updateParameters).toHaveBeenCalledTimes(1);
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
