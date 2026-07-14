import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GIT_PLUGIN_MANIFEST } from "@plugins/builtin/git/manifest.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  type PluginRegistryEntry,
  pluginManifestSchema,
} from "@shared/contracts/plugin.ts";
import type { DockviewApi } from "dockview-react";
import i18next from "i18next";
import { House } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const FILE_WRITE_CAPABILITY_PATTERN = /file:write/;
const GIT_READ_CAPABILITY_PATTERN = /git:read/;
const GIT_WRITE_CAPABILITY_PATTERN = /git:write/;
const COMMAND_GIT_WRITE_CAPABILITY_PATTERN =
  /plugin capability not granted:.*git:write/;
const WORKSPACE_OPEN_CAPABILITY_PATTERN =
  /plugin capability not granted:.*workspace:open/;
const WORKTREE_READ_CAPABILITY_PATTERN =
  /plugin capability not granted:.*worktree:read/;
const WORKTREE_WRITE_CAPABILITY_PATTERN =
  /plugin capability not granted:.*worktree:write/;
const GROUP_CONTENT_ID_PREFIX_PATTERN =
  /groupContent id must start with.*sample\.plugin\./;
const ENVIRONMENT_READ_CAPABILITY_PATTERN = /environment:read/;
const CONFIGURABLE_WIDGET_SETTINGS_PATTERN = /settingsComponent/i;
const EXTERNAL_OPEN_CAPABILITY_PATTERN = /external:open/;

const toastMocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "toast-1"),
  success: vi.fn(),
}));

const workspaceActivationMocks = vi.hoisted(() => ({
  activateWorkspacePanel: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

vi.mock("@/lib/workspace/panel-activation.ts", () => ({
  activateWorkspacePanel: workspaceActivationMocks.activateWorkspacePanel,
}));

import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";
import { clearHostGroupContentForTests } from "@/lib/plugins/host-group-content-context.tsx";
import { mermaidRenderer } from "@/lib/plugins/mermaid-renderer.ts";
import { pluginLifecycleBarriers } from "@/lib/plugins/plugin-lifecycle-barriers.ts";
import { clearPluginPanelsForTests } from "@/lib/plugins/plugin-panel-registry.ts";
import {
  clearPluginWorkbenchWidgetsForTests,
  getPluginWorkbenchWidgetRegistrations,
} from "@/lib/plugins/plugin-workbench-widget-registry.ts";
import { terminalStatusItemRegistry } from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { useFontStore } from "@/stores/font.store.ts";
import { useLocaleStore } from "@/stores/locale.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useThemeStore } from "@/stores/theme.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const panelContext: PanelContext = {
  branch: "main",
  contextId: "ctx-pier",
  cwd: "/Users/xyz/ABC/pier",
  gitRoot: "/Users/xyz/ABC/pier",
  openedPath: "/Users/xyz/ABC/pier",
  projectRootPath: "/Users/xyz/ABC/pier",
  source: "panel",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/Users/xyz/ABC/pier",
  worktreeRoot: "/Users/xyz/ABC/pier",
};

interface ExpectedFilesFacade {
  confirmDurability(request: {
    expectedRevision: string;
    path: string;
    root: string;
  }): Promise<unknown>;
  inspectWriteTarget(request: { path: string; root: string }): Promise<unknown>;
  list(request: { path: string; root: string }): Promise<unknown>;
  move(request: {
    newPath: string;
    path: string;
    root: string;
  }): Promise<unknown>;
  readDocument(request: { path: string; root: string }): Promise<unknown>;
  readText(request: { path: string; root: string }): Promise<string>;
  stat(request: { path: string; root: string }): Promise<unknown>;
  trash(request: { path: string; root: string }): Promise<unknown>;
  watch(root: string, listener: (event: unknown) => void): () => void;
  writeDocument(request: {
    contents: string;
    eol: "cr" | "crlf" | "lf";
    expected: { kind: "absent" } | { kind: "revision"; revision: string };
    format:
      | { bom: boolean; encoding: "utf8" }
      | { bom: true; encoding: "utf16be" | "utf16le" };
    path: string;
    root: string;
  }): Promise<unknown>;
  writeText(request: {
    contents: string;
    path: string;
    root: string;
  }): Promise<unknown>;
}

type ExpectedGitFacade = RendererPluginContext["git"] & {
  discardChanges(cwd: string, paths: string[]): Promise<boolean>;
  getDiffPatch(
    cwd: string,
    options?: { paths?: string[]; staged?: boolean }
  ): Promise<unknown>;
  getFileContent(
    cwd: string,
    options: { path: string; ref?: string }
  ): Promise<string>;
  stage(cwd: string, paths: string[]): Promise<boolean>;
  unstage(cwd: string, paths: string[]): Promise<boolean>;
};

const sampleCommands = [
  { id: "sample.list", permissions: [], title: "Sample: List" },
];

const sampleTerminalStatusItems = [
  { id: "sample.status", permissions: [], title: "Sample Status" },
];
const sampleWorkbenchWidgets = [
  { id: "sample.widget", permissions: [], title: "Sample Widget" },
];
const undeclaredContributionErrorPattern = /not declared/;

const pluginEntry = {
  effectivePermissions: ["command:register"],
  enabled: true,
  manifest: {
    apiVersion: 1,
    commands: sampleCommands,
    engines: { pier: ">=0.1.0" },
    id: "sample.plugin",
    localization: {
      defaultLocale: "en",
      files: {},
      locales: ["en", "zh-CN", "fr"],
    },
    locales: {
      en: {
        commands: {
          "sample.list": {
            aliases: ["sample list", "sample command"],
            title: "Sample: List",
          },
        },
        messages: {
          "ui.statusOpenLabel": "Open sample for {{name}}",
          "ui.title": "Samples",
        },
      },
      "zh-CN": {
        commands: {
          "sample.list": {
            aliases: ["示例列表", "shili liebiao"],
            title: "示例列表",
          },
        },
        messages: {
          "ui.statusOpenLabel": "打开 {{name}} 的示例",
          "ui.title": "示例",
        },
      },
      fr: {
        commands: {
          "sample.list": {
            aliases: ["liste exemple"],
            title: "Liste d'exemples",
          },
        },
      },
    },
    name: "Sample",
    panels: [],
    permissions: ["command:register"],
    source: { kind: "builtin" },
    terminalStatusItems: sampleTerminalStatusItems,
    workbenchWidgets: sampleWorkbenchWidgets,
    settingsPages: [],
    version: "1.0.0",
  },
  runtime: {
    canToggle: true,
    enabled: true,
    kind: "builtin",
  },
} satisfies PluginRegistryEntry;

const configurableWidgetEntry = {
  ...pluginEntry,
  manifest: {
    ...pluginEntry.manifest,
    workbenchWidgets: [
      {
        configurable: true,
        defaultSize: { h: 4, w: 4 },
        id: "sample.configurableWidget",
        maxSize: { h: 12, w: 12 },
        minSize: { h: 2, w: 2 },
        permissions: [],
        title: "Configurable Widget",
      },
    ],
  },
} satisfies PluginRegistryEntry;

const commandPermissionEntry = {
  ...pluginEntry,
  manifest: {
    ...pluginEntry.manifest,
    commands: [
      ...sampleCommands,
      {
        id: "sample.write",
        permissions: ["git:write"],
        title: "Sample: Write",
      },
    ],
  },
} satisfies PluginRegistryEntry;

function createMockDockviewGroup(activeComponent = "pier.files.filePanel"): {
  container: HTMLElement;
  emitActiveChange: () => void;
  group: PierDockviewGroupHandle;
  setActiveComponent: (component: string) => void;
} {
  const root = document.createElement("div");
  const container = document.createElement("div");
  container.className = "dv-content-container";
  root.appendChild(container);
  document.body.appendChild(root);
  const listeners = new Set<(event: unknown) => void>();
  const activePanel = {
    id: "active-panel",
    view: { contentComponent: activeComponent },
  };
  const group: PierDockviewGroupHandle = {
    activePanel,
    api: {
      onDidActivePanelChange: (listener) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    },
    element: root,
    id: "group-a",
  };
  return {
    container,
    emitActiveChange: () => {
      for (const listener of listeners) {
        listener({});
      }
    },
    group,
    setActiveComponent: (component) => {
      activePanel.view.contentComponent = component;
    },
  };
}

function createWorktreesFacadeMock() {
  return {
    check: vi.fn(async () => ({
      mainPath: "/repo",
      path: "/repo",
      status: "supported" as const,
    })),
    create: vi.fn(async () => ({
      created: {
        bare: false,
        branch: "feature/new",
        detached: false,
        head: "abc123",
        isCurrent: false,
        isMain: false,
        locked: false,
        lockedReason: null,
        path: "/repo/.worktrees/new",
        prunable: false,
        prunableReason: null,
      },
      targetPath: "/repo/.worktrees/new",
      worktrees: [],
    })),
    creationDefaults: vi.fn(async () => ({
      copyPatterns: [".env"],
      rootPath: "/repo",
    })),
    list: vi.fn(async () => ({
      mainPath: "/repo",
      path: "/repo",
      status: "available" as const,
      worktrees: [],
    })),
    open: vi.fn(async () => ({
      context: panelContext,
      panelId: "terminal-worktree",
    })),
    openTerminal: vi.fn(async () => ({
      panelId: "terminal-worktree",
    })),
    prune: vi.fn(async () => ({
      mainPath: "/repo",
      path: "/repo",
      status: "available" as const,
      worktrees: [],
    })),
    remove: vi.fn(async () => ({
      removedPath: "/repo/.worktrees/new",
      worktrees: [],
    })),
  };
}

beforeAll(async () => {
  await initI18n();
});

afterEach(() => {
  clearHostGroupContentForTests();
  for (const pluginId of pluginLifecycleBarriers.pluginIds()) {
    pluginLifecycleBarriers.clear(pluginId);
  }
  document.body.replaceChildren();
  clearPluginPanelsForTests();
  terminalStatusItemRegistry.clearForTests();
  useCommandPaletteController.setState({
    mode: "commands",
    open: false,
    quickPick: null,
    requestId: 0,
    stack: [],
  });
  usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
  useWorkspaceStore.setState({ api: null });
  workspaceActivationMocks.activateWorkspacePanel.mockReset();
  vi.restoreAllMocks();
  clearPluginWorkbenchWidgetsForTests();
  vi.useRealTimers();
});

describe("createRendererPluginContext", () => {
  it("declares environment read permission for Git worktree actions that read environment state", () => {
    const createCommand = GIT_PLUGIN_MANIFEST.commands.find(
      (command) => command.id === "pier.worktree.create"
    );
    const deleteCommand = GIT_PLUGIN_MANIFEST.commands.find(
      (command) => command.id === "pier.worktree.delete"
    );

    expect(GIT_PLUGIN_MANIFEST.permissions).toContain("environment:read");
    expect(createCommand?.permissions).toEqual(
      expect.arrayContaining(["environment:read"])
    );
    expect(deleteCommand?.permissions).toEqual(
      expect.arrayContaining(["environment:read"])
    );
  });

  it("delegates terminal status item registration to the internal registry", () => {
    const context = createRendererPluginContext();

    const dispose = context.terminalStatusItems.register({
      id: "test.status",
      render: () => "status",
    });

    expect(terminalStatusItemRegistry.list().map((item) => item.id)).toEqual([
      "test.status",
    ]);

    dispose();
    expect(terminalStatusItemRegistry.list()).toEqual([]);
  });

  it("delegates action registration to the internal action registry", () => {
    const context = createRendererPluginContext();

    const dispose = context.actions.register({
      category: "Test",
      handler: () => undefined,
      id: "test.action",
      metadata: {
        categoryKey: "worktree",
      },
      surfaces: ["command-palette"],
      title: () => "Test Action",
    });

    expect(actionRegistry.get("test.action")?.title()).toBe("Test Action");
    expect(actionRegistry.get("test.action")?.metadata).toMatchObject({
      categoryKey: "worktree",
    });

    dispose();
    expect(actionRegistry.get("test.action")).toBeUndefined();
  });

  it("adds declared command aliases from plugin locales during action registration", async () => {
    await i18next.changeLanguage("zh-CN");
    const context = createRendererPluginContext(pluginEntry);

    const dispose = context.actions.register({
      category: "Test",
      handler: () => undefined,
      id: "sample.list",
      metadata: {
        categoryKey: "worktree",
      },
      surfaces: ["command-palette"],
      title: () => "Sample",
    });

    expect(actionRegistry.get("sample.list")?.metadata?.aliases?.()).toEqual([
      "示例列表",
      "shili liebiao",
      "sample list",
      "sample command",
      "liste exemple",
    ]);

    dispose();
  });

  it("rejects action registration not declared by the plugin manifest", () => {
    const context = createRendererPluginContext(pluginEntry);

    expect(() =>
      context.actions.register({
        category: "Test",
        handler: () => undefined,
        id: "sample.missing",
        title: () => "Missing",
      })
    ).toThrow(undeclaredContributionErrorPattern);
    expect(actionRegistry.get("sample.missing")).toBeUndefined();
  });

  it("blocks gated action invocation before the plugin handler when capability is missing", () => {
    const handler = vi.fn();
    const context = createRendererPluginContext({
      ...commandPermissionEntry,
      effectivePermissions: ["command:register"],
    });

    const dispose = context.actions.register({
      category: "Test",
      handler,
      id: "sample.write",
      title: () => "Sample: Write",
    });

    const registered = actionRegistry.get("sample.write");
    expect(registered).toBeDefined();
    expect(() => registered?.handler()).toThrow(
      COMMAND_GIT_WRITE_CAPABILITY_PATTERN
    );
    expect(handler).not.toHaveBeenCalled();

    dispose();
  });

  it("invokes gated action handlers once the declared capability is granted", () => {
    const handler = vi.fn();
    const context = createRendererPluginContext({
      ...commandPermissionEntry,
      effectivePermissions: ["command:register", "git:write"],
    });

    const dispose = context.actions.register({
      category: "Test",
      handler,
      id: "sample.write",
      title: () => "Sample: Write",
    });

    actionRegistry.get("sample.write")?.handler();
    expect(handler).toHaveBeenCalledTimes(1);

    dispose();
  });

  it("rejects terminal status registration not declared by the plugin manifest", () => {
    const context = createRendererPluginContext(pluginEntry);

    expect(() =>
      context.terminalStatusItems.register({
        id: "sample.missingStatus",
        render: () => "status",
      })
    ).toThrow(undeclaredContributionErrorPattern);
    expect(terminalStatusItemRegistry.list()).toEqual([]);
  });

  it("delegates Workbench widget registration to the internal registry", () => {
    const context = createRendererPluginContext(pluginEntry);

    const dispose = context.workbenchWidgets.register({
      component: () => null,
      icon: House,
      id: "sample.widget",
    });

    expect(getPluginWorkbenchWidgetRegistrations().has("sample.widget")).toBe(
      true
    );

    dispose();
    expect(getPluginWorkbenchWidgetRegistrations().has("sample.widget")).toBe(
      false
    );
  });

  it("rejects a configurable builtin widget without a settings component", () => {
    const context = createRendererPluginContext(configurableWidgetEntry);

    expect(() =>
      context.workbenchWidgets.register({
        component: () => null,
        icon: House,
        id: "sample.configurableWidget",
      })
    ).toThrow(CONFIGURABLE_WIDGET_SETTINGS_PATTERN);
    expect(
      getPluginWorkbenchWidgetRegistrations().has("sample.configurableWidget")
    ).toBe(false);
  });

  it("registers a configurable builtin widget with its settings component", () => {
    const context = createRendererPluginContext(configurableWidgetEntry);
    const registration = {
      component: () => null,
      icon: House,
      id: "sample.configurableWidget",
      settingsComponent: () => null,
    };

    const dispose = context.workbenchWidgets.register(registration);

    expect(
      getPluginWorkbenchWidgetRegistrations().get("sample.configurableWidget")
    ).toBe(registration);
    dispose();
  });

  it("rejects Workbench widget registration not declared by the plugin manifest", () => {
    const context = createRendererPluginContext(pluginEntry);

    expect(() =>
      context.workbenchWidgets.register({
        component: () => null,
        icon: House,
        id: "sample.missingWidget",
      })
    ).toThrow(undeclaredContributionErrorPattern);
    expect(
      getPluginWorkbenchWidgetRegistrations().has("sample.missingWidget")
    ).toBe(false);
  });

  it("allows Workbench widget registration without entry (core context)", () => {
    const context = createRendererPluginContext();

    const dispose = context.workbenchWidgets.register({
      component: () => null,
      icon: House,
      id: "any.widget",
    });

    expect(getPluginWorkbenchWidgetRegistrations().has("any.widget")).toBe(
      true
    );

    dispose();
  });

  it("claims declared group content through the real host context and releases it after the grace period", async () => {
    vi.useFakeTimers();
    const pluginEntryWithGroupContent: PluginRegistryEntry = {
      ...pluginEntry,
      manifest: {
        ...pluginEntry.manifest,
        groupContent: [
          {
            id: "sample.plugin.groupView",
            title: "Sample Group View",
          },
        ],
      },
    };
    const context = createRendererPluginContext(pluginEntryWithGroupContent);
    const ownerId = Symbol("owner");
    const { container, emitActiveChange, group, setActiveComponent } =
      createMockDockviewGroup();

    expect(
      context.groupContent.claim({
        group,
        id: "sample.plugin.groupView",
        ownerId,
        render: () => <div data-testid="sample-group-view">Sample</div>,
        visible: (candidate) =>
          candidate.activePanel?.view?.contentComponent ===
          "pier.files.filePanel",
      })
    ).toBe(true);
    expect(
      container.querySelector('[data-slot="sample.plugin.groupView"]')
    ).toBeInstanceOf(HTMLElement);

    setActiveComponent("terminal");
    emitActiveChange();
    expect(
      container.querySelector<HTMLElement>(
        '[data-slot="sample.plugin.groupView"]'
      )?.style.visibility
    ).toBe("hidden");

    context.groupContent.release({
      groupId: "group-a",
      id: "sample.plugin.groupView",
      ownerId,
    });
    expect(
      container.querySelector('[data-slot="sample.plugin.groupView"]')
    ).toBeInstanceOf(HTMLElement);
    await vi.advanceTimersByTimeAsync(999);
    expect(
      container.querySelector('[data-slot="sample.plugin.groupView"]')
    ).toBeInstanceOf(HTMLElement);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      container.querySelector('[data-slot="sample.plugin.groupView"]')
    ).toBeNull();
  });

  it("rejects undeclared group content claims", () => {
    const context = createRendererPluginContext(pluginEntry);
    const ownerId = Symbol("owner");
    const { group } = createMockDockviewGroup();

    expect(() =>
      context.groupContent.claim({
        group,
        id: "sample.plugin.missingGroupView",
        ownerId,
        render: () => <div />,
        visible: () => true,
      })
    ).toThrow(undeclaredContributionErrorPattern);
  });

  it("requires group content contribution ids to use the plugin namespace", () => {
    expect(() =>
      pluginManifestSchema.parse({
        ...pluginEntry.manifest,
        groupContent: [{ id: "wrong.groupView", title: "Wrong Group View" }],
      })
    ).toThrow(GROUP_CONTENT_ID_PREFIX_PATTERN);
  });

  it("opens quick-pick through the command palette controller", () => {
    const context = createRendererPluginContext();

    context.commandPalette.openQuickPick({
      items: [
        {
          aliases: ["uno"],
          id: "one",
          label: "One",
          searchTerms: ["first item"],
        },
      ],
      onAccept: () => undefined,
      title: "Pick",
    });

    expect(useCommandPaletteController.getState().quickPick).toMatchObject({
      items: [
        {
          aliases: ["uno"],
          id: "one",
          label: "One",
          searchTerms: ["first item"],
        },
      ],
      title: "Pick",
    });
  });

  it("adapts query-derived plugin quick-pick items through onAccept", async () => {
    const context = createRendererPluginContext();
    const onAccept = vi.fn();

    context.commandPalette.openQuickPick({
      getQueryItem: (query) => ({
        data: { name: query },
        id: `create:${query}`,
        label: `Create ${query}`,
      }),
      items: [],
      onAccept,
      title: "Pick",
    });

    const quickPick = useCommandPaletteController.getState().quickPick;
    const item = quickPick?.getQueryItem?.("feature/new");
    expect(item).toMatchObject({
      data: { name: "feature/new" },
      id: "create:feature/new",
      label: "Create feature/new",
    });
    if (!(quickPick && item)) {
      throw new Error("expected query-derived quick-pick item");
    }

    await quickPick.onAccept(item);
    expect(onAccept).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: "feature/new" },
        id: "create:feature/new",
      })
    );
  });

  it("returns the active panel context through a controlled panels facade", () => {
    const context = createRendererPluginContext();
    expect(context.panels.getActiveContext()).toBeNull();

    usePanelDescriptorStore.setState({
      activeId: "terminal-1",
      descriptors: {
        "terminal-1": {
          context: panelContext,
          display: { short: "pier" },
        },
      },
    });

    expect(context.panels.getActiveContext()).toEqual(panelContext);
  });

  it("updates an existing plugin panel's params before activating it", () => {
    const panelId = "sample.panel";
    const pluginEntryWithPanel: PluginRegistryEntry = {
      ...pluginEntry,
      effectivePermissions: ["panel:register", "panel:open"],
      manifest: {
        ...pluginEntry.manifest,
        panels: [{ id: panelId, permissions: [], title: "Sample Panel" }],
        permissions: ["panel:register", "panel:open"],
      },
    };
    const updateParameters = vi.fn();
    const addPanel = vi.fn();
    const api = {
      addPanel,
      panels: [
        {
          api: { updateParameters },
          id: panelId,
        },
      ],
    } as unknown as DockviewApi;
    const nextContext: PanelContext = {
      ...panelContext,
      contextId: "ctx-next",
      gitRoot: "/Users/xyz/ABC/pier-next",
      updatedAt: panelContext.updatedAt + 1,
    };
    const registeredParams = {
      heading: "Registered heading",
      provider: "sample",
    };
    useWorkspaceStore.setState({ api });

    const context = createRendererPluginContext(pluginEntryWithPanel);
    context.panels.register({
      component: () => null,
      getParams: () => registeredParams,
      icon: House,
      id: panelId,
      kind: "web",
      title: "Sample Panel",
    });

    context.panels.open(panelId, { context: nextContext });

    expect(updateParameters).toHaveBeenCalledTimes(1);
    expect(updateParameters).toHaveBeenCalledWith({
      ...registeredParams,
      context: nextContext,
    });
    expect(
      workspaceActivationMocks.activateWorkspacePanel
    ).toHaveBeenCalledWith(api, panelId, { reveal: "always" });
    expect(addPanel).not.toHaveBeenCalled();
  });

  it("merges params into an owned plugin panel instance", () => {
    const panelId = "sample.panel";
    const pluginEntryWithPanel: PluginRegistryEntry = {
      ...pluginEntry,
      effectivePermissions: ["panel:open"],
      manifest: {
        ...pluginEntry.manifest,
        panels: [{ id: panelId, permissions: [], title: "Sample Panel" }],
        permissions: ["panel:open"],
      },
    };
    const updateParameters = vi.fn();
    useWorkspaceStore.setState({
      api: {
        panels: [
          {
            api: { updateParameters },
            id: "sample-instance",
            params: { retained: true, source: { kind: "disk" } },
            view: { contentComponent: panelId },
          },
        ],
      } as unknown as DockviewApi,
    });
    const context = createRendererPluginContext(pluginEntryWithPanel);

    expect(
      context.panels.updateInstanceParams(panelId, "sample-instance", {
        source: { id: "untitled-1", kind: "untitled" },
      })
    ).toBe(true);
    expect(updateParameters).toHaveBeenCalledWith({
      retained: true,
      source: { id: "untitled-1", kind: "untitled" },
    });
  });

  it("delegates worktree methods to the preload facade", async () => {
    const check = vi.fn(async () => ({
      mainPath: "/repo",
      path: "/repo",
      status: "supported" as const,
    }));
    const list = vi.fn(async () => ({
      mainPath: "/repo",
      path: "/repo",
      status: "available" as const,
      worktrees: [],
    }));
    const create = vi.fn(async () => ({
      created: {
        bare: false,
        branch: "feature/new",
        detached: false,
        head: "abc123",
        isCurrent: false,
        isMain: false,
        locked: false,
        lockedReason: null,
        path: "/repo/.worktrees/new",
        prunable: false,
        prunableReason: null,
      },
      targetPath: "/repo/.worktrees/new",
      worktrees: [],
    }));
    const open = vi.fn(async () => ({
      panelId: "terminal-worktree",
    }));
    const prune = vi.fn(async () => ({
      mainPath: "/repo",
      path: "/repo",
      status: "available" as const,
      worktrees: [],
    }));
    const remove = vi.fn(async () => ({
      removedPath: "/repo/.worktrees/new",
      worktrees: [],
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        worktrees: { check, create, list, open, prune, remove },
      },
    });

    const context = createRendererPluginContext();

    await context.worktrees.check({ path: "/repo" });
    const onProgress = vi.fn();
    await context.worktrees.create(
      {
        branch: "feature/new",
        name: "new",
        path: "/repo",
      },
      { onProgress }
    );
    await context.worktrees.list({ path: "/repo" });
    await context.worktrees.open({ path: "/repo" });
    await context.worktrees.prune({ path: "/repo" });
    await context.worktrees.remove({ path: "/repo/.worktrees/new" });

    expect(check).toHaveBeenCalledWith({ path: "/repo" });
    expect(create).toHaveBeenCalledWith(
      {
        branch: "feature/new",
        name: "new",
        path: "/repo",
      },
      { onProgress }
    );
    expect(list).toHaveBeenCalledWith({ path: "/repo" });
    expect(open).toHaveBeenCalledWith({ path: "/repo" });
    expect(prune).toHaveBeenCalledWith({ path: "/repo" });
    expect(remove).toHaveBeenCalledWith({ path: "/repo/.worktrees/new" });
  });

  it("blocks worktree reads before the preload facade when worktree:read is missing", async () => {
    const worktrees = createWorktreesFacadeMock();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { worktrees },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["worktree:write", "workspace:open"],
    });

    const readCalls: ReadonlyArray<() => Promise<unknown>> = [
      () => context.worktrees.check({ path: "/repo" }),
      () => context.worktrees.creationDefaults({ path: "/repo" }),
      () => context.worktrees.list({ path: "/repo" }),
    ];
    for (const call of readCalls) {
      await expect(Promise.resolve().then(call)).rejects.toThrow(
        WORKTREE_READ_CAPABILITY_PATTERN
      );
    }

    for (const preloadMethod of Object.values(worktrees)) {
      expect(preloadMethod).not.toHaveBeenCalled();
    }
  });

  it("blocks worktree mutations before the preload facade when worktree:write is missing", async () => {
    const worktrees = createWorktreesFacadeMock();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { worktrees },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["worktree:read", "workspace:open"],
    });

    const writeCalls: ReadonlyArray<() => Promise<unknown>> = [
      () =>
        context.worktrees.create({
          branch: "feature/new",
          name: "new",
          path: "/repo",
        }),
      () =>
        context.worktrees.openTerminal({
          path: "/repo/.worktrees/new",
        }),
      () => context.worktrees.prune({ path: "/repo" }),
      () => context.worktrees.remove({ path: "/repo/.worktrees/new" }),
    ];
    for (const call of writeCalls) {
      await expect(Promise.resolve().then(call)).rejects.toThrow(
        WORKTREE_WRITE_CAPABILITY_PATTERN
      );
    }

    for (const preloadMethod of Object.values(worktrees)) {
      expect(preloadMethod).not.toHaveBeenCalled();
    }
  });

  it("blocks worktree open before the preload facade until both worktree:read and workspace:open are granted", async () => {
    const worktrees = createWorktreesFacadeMock();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { worktrees },
    });

    const openOnlyContext = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["workspace:open"],
    });
    await expect(
      Promise.resolve().then(() =>
        openOnlyContext.worktrees.open({ path: "/repo" })
      )
    ).rejects.toThrow(WORKTREE_READ_CAPABILITY_PATTERN);

    const readOnlyContext = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["worktree:read"],
    });
    await expect(
      Promise.resolve().then(() =>
        readOnlyContext.worktrees.open({ path: "/repo" })
      )
    ).rejects.toThrow(WORKSPACE_OPEN_CAPABILITY_PATTERN);
    expect(worktrees.open).not.toHaveBeenCalled();

    const grantedContext = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["worktree:read", "workspace:open"],
    });
    await expect(
      grantedContext.worktrees.open({ path: "/repo" })
    ).resolves.toEqual({
      context: panelContext,
      panelId: "terminal-worktree",
    });
    expect(worktrees.open).toHaveBeenCalledWith({ path: "/repo" });
  });

  it("allows worktree plugins with full permissions to invoke every preload method", async () => {
    const worktrees = createWorktreesFacadeMock();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { worktrees },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: [
        "workspace:open",
        "worktree:read",
        "worktree:write",
      ],
    });

    await context.worktrees.check({ path: "/repo" });
    await context.worktrees.create({
      branch: "feature/new",
      name: "new",
      path: "/repo",
    });
    await expect(
      context.worktrees.creationDefaults({ path: "/repo" })
    ).resolves.toEqual({
      copyPatterns: [".env"],
      rootPath: "/repo",
    });
    await context.worktrees.list({ path: "/repo" });
    await context.worktrees.open({ path: "/repo" });
    await expect(
      context.worktrees.openTerminal({
        path: "/repo/.worktrees/new",
      })
    ).resolves.toEqual({ panelId: "terminal-worktree" });
    await context.worktrees.prune({ path: "/repo" });
    await context.worktrees.remove({ path: "/repo/.worktrees/new" });

    expect(worktrees.check).toHaveBeenCalledWith({ path: "/repo" });
    expect(worktrees.create).toHaveBeenCalledWith({
      branch: "feature/new",
      name: "new",
      path: "/repo",
    });
    expect(worktrees.creationDefaults).toHaveBeenCalledWith({ path: "/repo" });
    expect(worktrees.list).toHaveBeenCalledWith({ path: "/repo" });
    expect(worktrees.open).toHaveBeenCalledWith({ path: "/repo" });
    expect(worktrees.openTerminal).toHaveBeenCalledWith({
      path: "/repo/.worktrees/new",
    });
    expect(worktrees.prune).toHaveBeenCalledWith({ path: "/repo" });
    expect(worktrees.remove).toHaveBeenCalledWith({
      path: "/repo/.worktrees/new",
    });
  });

  it("delegates file methods to the preload facade", async () => {
    const root = "/repo";
    const list = vi.fn(async () => [
      { kind: "file", path: "src/index.ts", root },
    ]);
    const readText = vi.fn(async () => "export const value = 1;\n");
    const readDocument = vi.fn(async () => ({
      contents: "export const value = 1;\n",
      kind: "text" as const,
      revision: "revision-1",
    }));
    const inspectWriteTarget = vi.fn(async () => ({ kind: "absent" as const }));
    const confirmDurability = vi.fn(async () => ({
      kind: "confirmed" as const,
      revision: "revision-2",
    }));
    const writeDocument = vi.fn(async () => ({
      durability: "confirmed" as const,
      kind: "written" as const,
      revision: "revision-2",
    }));
    const writeText = vi.fn(async () => ({
      mtimeMs: 1,
      written: true as const,
    }));
    const move = vi.fn(async () => ({ moved: true }));
    const trash = vi.fn(async () => ({ trashed: true }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        files: {
          confirmDurability,
          inspectWriteTarget,
          list,
          move,
          readDocument,
          readText,
          stat: vi.fn(async () => ({
            exists: true,
            isDirectory: false,
            mtimeMs: 1,
            path: "x",
            root: "/repo",
            size: 0,
          })),
          trash,
          watch: vi.fn(() => () => undefined),
          writeDocument,
          writeText,
        },
      },
    });
    const context = createRendererPluginContext() as RendererPluginContext & {
      files: ExpectedFilesFacade;
    };

    await expect(context.files.list({ path: "src", root })).resolves.toEqual([
      { kind: "file", path: "src/index.ts", root },
    ]);
    await expect(
      context.files.readDocument({ path: "src/index.ts", root })
    ).resolves.toMatchObject({ kind: "text", revision: "revision-1" });
    await expect(
      context.files.inspectWriteTarget({ path: "src/new.ts", root })
    ).resolves.toEqual({ kind: "absent" });
    await expect(
      context.files.writeDocument({
        contents: "export const value = 2;\n",
        eol: "lf",
        expected: { kind: "revision", revision: "revision-1" },
        format: { bom: false, encoding: "utf8" },
        path: "src/index.ts",
        root,
      })
    ).resolves.toMatchObject({ kind: "written", revision: "revision-2" });
    await expect(
      context.files.confirmDurability({
        expectedRevision: "revision-2",
        path: "src/index.ts",
        root,
      })
    ).resolves.toEqual({ kind: "confirmed", revision: "revision-2" });
    await expect(
      context.files.readText({ path: "src/index.ts", root })
    ).resolves.toBe("export const value = 1;\n");
    await expect(
      context.files.writeText({
        contents: "export const value = 2;\n",
        path: "src/index.ts",
        root,
      })
    ).resolves.toEqual({ mtimeMs: 1, written: true });
    await expect(
      context.files.move({
        newPath: "packages/app/src/index.ts",
        path: "src/main.ts",
        root,
      })
    ).resolves.toEqual({ moved: true });
    await expect(
      context.files.trash({ path: "packages/app/src/index.ts", root })
    ).resolves.toEqual({ trashed: true });

    expect(list).toHaveBeenCalledWith({ path: "src", root });
    expect(readText).toHaveBeenCalledWith({ path: "src/index.ts", root });
    expect(readDocument).toHaveBeenCalledWith({ path: "src/index.ts", root });
    expect(inspectWriteTarget).toHaveBeenCalledWith({
      path: "src/new.ts",
      root,
    });
    expect(writeDocument).toHaveBeenCalledWith({
      contents: "export const value = 2;\n",
      eol: "lf",
      expected: { kind: "revision", revision: "revision-1" },
      format: { bom: false, encoding: "utf8" },
      path: "src/index.ts",
      root,
    });
    expect(confirmDurability).toHaveBeenCalledWith({
      expectedRevision: "revision-2",
      path: "src/index.ts",
      root,
    });
    expect(writeText).toHaveBeenCalledWith({
      contents: "export const value = 2;\n",
      path: "src/index.ts",
      root,
    });
    expect(move).toHaveBeenCalledWith({
      newPath: "packages/app/src/index.ts",
      path: "src/main.ts",
      root,
    });
    expect(trash).toHaveBeenCalledWith({
      path: "packages/app/src/index.ts",
      root,
    });
  });

  it("allows read-only file plugins to list and read but blocks mutations before the preload facade", async () => {
    const root = "/repo";
    const list = vi.fn(async () => [
      { kind: "file", path: "src/index.ts", root },
    ]);
    const readText = vi.fn(async () => "export const value = 1;\n");
    const writeText = vi.fn(async () => ({
      mtimeMs: 1,
      written: true as const,
    }));
    const move = vi.fn(async () => ({ moved: true }));
    const trash = vi.fn(async () => ({ trashed: true }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        files: {
          list,
          move,
          readText,
          stat: vi.fn(async () => ({
            exists: true,
            isDirectory: false,
            mtimeMs: 1,
            path: "x",
            root: "/repo",
            size: 0,
          })),
          trash,
          watch: vi.fn(() => () => undefined),
          writeText,
        },
      },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["file:read"],
    }) as RendererPluginContext & {
      files: ExpectedFilesFacade;
    };

    await expect(context.files.list({ path: "src", root })).resolves.toEqual([
      { kind: "file", path: "src/index.ts", root },
    ]);
    await expect(
      context.files.readText({ path: "src/index.ts", root })
    ).resolves.toBe("export const value = 1;\n");

    await expect(
      Promise.resolve().then(() =>
        context.files.writeText({
          contents: "export const value = 2;\n",
          path: "src/index.ts",
          root,
        })
      )
    ).rejects.toThrow(FILE_WRITE_CAPABILITY_PATTERN);
    await expect(
      Promise.resolve().then(() =>
        context.files.move({
          newPath: "packages/app/src/index.ts",
          path: "src/index.ts",
          root,
        })
      )
    ).rejects.toThrow(FILE_WRITE_CAPABILITY_PATTERN);
    await expect(
      Promise.resolve().then(() =>
        context.files.trash({ path: "src/index.ts", root })
      )
    ).rejects.toThrow(FILE_WRITE_CAPABILITY_PATTERN);

    expect(list).toHaveBeenCalledWith({ path: "src", root });
    expect(readText).toHaveBeenCalledWith({ path: "src/index.ts", root });
    expect(writeText).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(trash).not.toHaveBeenCalled();
  });

  it("guards revision-safe file methods with read/write capabilities", async () => {
    const root = "/repo";
    const readDocument = vi.fn(async () => ({
      contents: "value\n",
      kind: "text" as const,
      revision: "revision-1",
    }));
    const inspectWriteTarget = vi.fn(async () => ({ kind: "absent" as const }));
    const writeDocument = vi.fn(async () => ({ kind: "written" as const }));
    const confirmDurability = vi.fn(async () => ({
      kind: "confirmed" as const,
      revision: "revision-1",
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        files: {
          confirmDurability,
          inspectWriteTarget,
          readDocument,
          writeDocument,
        },
      },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["file:read"],
    });

    await expect(
      context.files.readDocument({ path: "notes.txt", root })
    ).resolves.toMatchObject({ kind: "text", revision: "revision-1" });
    await expect(
      Promise.resolve().then(() =>
        context.files.inspectWriteTarget({ path: "notes.txt", root })
      )
    ).rejects.toThrow(FILE_WRITE_CAPABILITY_PATTERN);
    await expect(
      Promise.resolve().then(() =>
        context.files.writeDocument({
          contents: "new\n",
          eol: "lf",
          expected: { kind: "revision", revision: "revision-1" },
          format: { bom: false, encoding: "utf8" },
          path: "notes.txt",
          root,
        })
      )
    ).rejects.toThrow(FILE_WRITE_CAPABILITY_PATTERN);
    await expect(
      Promise.resolve().then(() =>
        context.files.confirmDurability({
          expectedRevision: "revision-1",
          path: "notes.txt",
          root,
        })
      )
    ).rejects.toThrow(FILE_WRITE_CAPABILITY_PATTERN);

    expect(readDocument).toHaveBeenCalledTimes(1);
    expect(inspectWriteTarget).not.toHaveBeenCalled();
    expect(writeDocument).not.toHaveBeenCalled();
    expect(confirmDurability).not.toHaveBeenCalled();
  });

  it("allows file plugins with write permission to invoke mutation methods", async () => {
    const root = "/repo";
    const list = vi.fn(async () => []);
    const readText = vi.fn(async () => "");
    const writeText = vi.fn(async () => ({
      mtimeMs: 1,
      written: true as const,
    }));
    const move = vi.fn(async () => ({ moved: true }));
    const trash = vi.fn(async () => ({ trashed: true }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        files: {
          list,
          move,
          readText,
          stat: vi.fn(async () => ({
            exists: true,
            isDirectory: false,
            mtimeMs: 1,
            path: "x",
            root: "/repo",
            size: 0,
          })),
          trash,
          watch: vi.fn(() => () => undefined),
          writeText,
        },
      },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["file:write"],
    }) as RendererPluginContext & {
      files: ExpectedFilesFacade;
    };

    await expect(
      context.files.writeText({
        contents: "export const value = 2;\n",
        path: "src/index.ts",
        root,
      })
    ).resolves.toEqual({ mtimeMs: 1, written: true });
    await expect(
      context.files.move({
        newPath: "packages/app/src/index.ts",
        path: "src/main.ts",
        root,
      })
    ).resolves.toEqual({ moved: true });
    await expect(
      context.files.trash({ path: "packages/app/src/index.ts", root })
    ).resolves.toEqual({ trashed: true });

    expect(writeText).toHaveBeenCalledWith({
      contents: "export const value = 2;\n",
      path: "src/index.ts",
      root,
    });
    expect(move).toHaveBeenCalledWith({
      newPath: "packages/app/src/index.ts",
      path: "src/main.ts",
      root,
    });
    expect(trash).toHaveBeenCalledWith({
      path: "packages/app/src/index.ts",
      root,
    });
  });

  it("blocks git reads and writes before the preload facade when capability is missing", async () => {
    const git = {
      abortMerge: vi.fn(async () => ({ status: "aborted" })),
      abortRebase: vi.fn(async () => ({ status: "aborted" })),
      continueRebase: vi.fn(async () => ({ status: "continued" })),
      discardChanges: vi.fn(async () => true),
      getDiffPatch: vi.fn(async () => ({ files: [] })),
      getFileContent: vi.fn(async () => "content"),
      getRepoInfo: vi.fn(async () => null),
      getStatus: vi.fn(async () => ({ counts: {}, files: [] })),
      listBranches: vi.fn(async () => []),
      listStashes: vi.fn(async () => []),
      merge: vi.fn(async () => ({ status: "merged" })),
      popStash: vi.fn(async () => ({ status: "popped" })),
      pullFastForward: vi.fn(async () => ({ kind: "ok" })),
      push: vi.fn(async () => ({ kind: "ok" })),
      rebase: vi.fn(async () => ({ status: "rebased" })),
      searchBranches: vi.fn(async () => ({ branches: [] })),
      stage: vi.fn(async () => true),
      stash: vi.fn(async () => ({ status: "stashed" })),
      sync: vi.fn(async () => ({ kind: "ok" })),
      undoLastCommit: vi.fn(async () => ({ status: "undone" })),
      unstage: vi.fn(async () => true),
      watch: vi.fn(() => () => undefined),
    };
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { git },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: [],
    }) as RendererPluginContext & { git: ExpectedGitFacade };

    const readCalls: ReadonlyArray<() => Promise<unknown>> = [
      () => context.git.getDiffPatch("/repo"),
      () => context.git.getFileContent("/repo", { path: "README.md" }),
      () => context.git.getRepoInfo("/repo"),
      () => context.git.getStatus("/repo"),
      () => context.git.listBranches("/repo", { kind: "all" }),
      () => context.git.listStashes("/repo"),
      () => context.git.searchBranches("/repo"),
    ];
    for (const call of readCalls) {
      await expect(Promise.resolve().then(call)).rejects.toThrow(
        GIT_READ_CAPABILITY_PATTERN
      );
    }
    expect(() => context.git.watch("/repo", vi.fn())).toThrow(
      GIT_READ_CAPABILITY_PATTERN
    );

    const writeCalls: ReadonlyArray<() => Promise<unknown>> = [
      () => context.git.abortMerge("/repo"),
      () => context.git.abortRebase("/repo"),
      () => context.git.continueRebase("/repo"),
      () => context.git.discardChanges("/repo", ["README.md"]),
      () => context.git.merge("/repo", "feature"),
      () => context.git.popStash("/repo"),
      () => context.git.pullFastForward("/repo"),
      () => context.git.push("/repo"),
      () => context.git.rebase("/repo", "main"),
      () => context.git.stage("/repo", ["README.md"]),
      () => context.git.stash("/repo"),
      () => context.git.sync("/repo"),
      () => context.git.undoLastCommit("/repo"),
      () => context.git.unstage("/repo", ["README.md"]),
    ];
    for (const call of writeCalls) {
      await expect(Promise.resolve().then(call)).rejects.toThrow(
        GIT_WRITE_CAPABILITY_PATTERN
      );
    }

    for (const preloadMethod of Object.values(git)) {
      expect(preloadMethod).not.toHaveBeenCalled();
    }
  });

  it("allows git plugins with read/write permissions to use widened preload methods", async () => {
    const patch = {
      files: [
        {
          binary: false,
          hunks: [],
          oldPath: null,
          path: "src/index.ts",
        },
      ],
    };
    const getDiffPatch = vi.fn(async () => patch);
    const getFileContent = vi.fn(async () => "export const value = 1;\n");
    const stage = vi.fn(async () => true);
    const unstage = vi.fn(async () => true);
    const discardChanges = vi.fn(async () => true);
    const push = vi.fn(async () => ({ kind: "ok" as const }));
    const pullFastForward = vi.fn(async () => ({ kind: "ok" as const }));
    const sync = vi.fn(async () => ({ kind: "ok" as const }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        git: {
          discardChanges,
          getDiffPatch,
          getFileContent,
          pullFastForward,
          push,
          stage,
          sync,
          unstage,
        },
      },
    });

    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["git:read", "git:write"],
    }) as RendererPluginContext & { git: ExpectedGitFacade };

    await expect(
      context.git.getDiffPatch("/repo", {
        paths: ["src/index.ts"],
        staged: true,
      })
    ).resolves.toEqual(patch);
    await expect(
      context.git.getFileContent("/repo", {
        path: "src/index.ts",
        ref: "HEAD",
      })
    ).resolves.toBe("export const value = 1;\n");
    await expect(context.git.stage("/repo", ["src/index.ts"])).resolves.toBe(
      true
    );
    await expect(context.git.unstage("/repo", ["src/index.ts"])).resolves.toBe(
      true
    );
    await expect(
      context.git.discardChanges("/repo", ["src/index.ts"])
    ).resolves.toBe(true);
    await expect(context.git.push("/repo")).resolves.toEqual({ kind: "ok" });
    await expect(context.git.pullFastForward("/repo")).resolves.toEqual({
      kind: "ok",
    });
    await expect(context.git.sync("/repo")).resolves.toEqual({ kind: "ok" });

    expect(getDiffPatch).toHaveBeenCalledWith("/repo", {
      paths: ["src/index.ts"],
      staged: true,
    });
    expect(getFileContent).toHaveBeenCalledWith("/repo", {
      path: "src/index.ts",
      ref: "HEAD",
    });
    expect(stage).toHaveBeenCalledWith("/repo", ["src/index.ts"]);
    expect(unstage).toHaveBeenCalledWith("/repo", ["src/index.ts"]);
    expect(discardChanges).toHaveBeenCalledWith("/repo", ["src/index.ts"]);
    expect(push).toHaveBeenCalledWith("/repo");
    expect(pullFastForward).toHaveBeenCalledWith("/repo");
    expect(sync).toHaveBeenCalledWith("/repo");
  });

  it("delegates plain notifications to the host toast layer", () => {
    const context = createRendererPluginContext();

    context.notifications.success("Merged", {
      action: { label: "Undo", onClick: () => undefined },
    });
    context.notifications.info("Nothing to stash");
    context.notifications.error("No active git panel");

    expect(toastMocks.success).toHaveBeenCalledWith("Merged", {
      action: { label: "Undo", onClick: expect.any(Function) },
    });
    expect(toastMocks.info).toHaveBeenCalledWith("Nothing to stash", undefined);
    expect(toastMocks.error).toHaveBeenCalledWith(
      "No active git panel",
      undefined
    );
  });

  it("delegates system notifications to the preload facade", async () => {
    const system = vi.fn(async () => ({ shown: true }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { notifications: { system } },
    });

    const context = createRendererPluginContext();

    await expect(
      context.notifications.system({ body: "Rebase finished", title: "Pier" })
    ).resolves.toEqual({ shown: true });
    expect(system).toHaveBeenCalledWith({
      body: "Rebase finished",
      title: "Pier",
    });
  });

  it("returns a loading handle that updates and dismisses the same toast", () => {
    const context = createRendererPluginContext();

    const loading = context.notifications.loading("Rebasing...");
    expect(toastMocks.loading).toHaveBeenCalledWith("Rebasing...");

    loading.update("Resolving dependencies...");
    expect(toastMocks.loading).toHaveBeenCalledWith(
      "Resolving dependencies...",
      { id: "toast-1" }
    );

    loading.info("Rebase stopped at conflict");
    expect(toastMocks.info).toHaveBeenCalledWith("Rebase stopped at conflict", {
      id: "toast-1",
    });

    loading.success("Rebase finished");
    expect(toastMocks.success).toHaveBeenCalledWith("Rebase finished", {
      id: "toast-1",
    });

    loading.dismiss();
    expect(toastMocks.dismiss).toHaveBeenCalledWith("toast-1");
  });

  it("resolves plugin-owned locale messages through the injected i18n facade", async () => {
    await i18next.changeLanguage("zh-CN");

    const context = createRendererPluginContext(pluginEntry);

    expect(context.i18n.language()).toBe("zh-CN");
    expect(context.i18n.commandTitle("sample.list")).toBe("示例列表");
    expect(context.i18n.t("ui.statusOpenLabel", { name: "pier" })).toBe(
      "打开 pier 的示例"
    );
    expect(context.i18n.t("ui.unknown", undefined, "Fallback")).toBe(
      "Fallback"
    );
  });
  it("blocks environment reads before the preload facade when environment:read is missing", async () => {
    const snapshotMock = vi.fn(async () => ({
      projects: [],
      version: 1 as const,
      worktreeBindings: [],
    }));
    const worktreeBindingMock = vi.fn(async () => null);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        environments: {
          snapshot: snapshotMock,
          worktreeBinding: worktreeBindingMock,
        },
      },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: [],
    });

    await expect(
      Promise.resolve().then(() =>
        context.environments.projectSnapshot("/repo")
      )
    ).rejects.toThrow(ENVIRONMENT_READ_CAPABILITY_PATTERN);
    await expect(
      Promise.resolve().then(() =>
        context.environments.worktreeBinding({ worktreePath: "/wt" })
      )
    ).rejects.toThrow(ENVIRONMENT_READ_CAPABILITY_PATTERN);
    expect(snapshotMock).not.toHaveBeenCalled();
    expect(worktreeBindingMock).not.toHaveBeenCalled();
  });

  it("delegates environment reads to the preload facade when environment:read is granted", async () => {
    const snapshotMock = vi.fn(async () => ({
      projects: [
        {
          cleanupCommand: "",
          env: {},
          projectRootPath: "/repo",
          setupCommand: "",
          updatedAt: 1,
        },
      ],
      version: 1 as const,
      worktreeBindings: [],
    }));
    const worktreeBindingMock = vi.fn(async () => ({
      cleanupCommand: "",
      env: {},
      hasCleanupScript: false,
      projectRootPath: "/repo",
      setupCommand: "",
      worktreePath: "/wt",
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        environments: {
          snapshot: snapshotMock,
          worktreeBinding: worktreeBindingMock,
        },
      },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["environment:read"],
    });

    const project = await context.environments.projectSnapshot("/repo");
    expect(project).toMatchObject({
      projectRootPath: "/repo",
    });
    expect(snapshotMock).toHaveBeenCalledWith({ projectRootPath: "/repo" });

    const binding = await context.environments.worktreeBinding({
      worktreePath: "/wt",
    });
    expect(binding).toMatchObject({ projectRootPath: "/repo" });
    expect(worktreeBindingMock).toHaveBeenCalledWith({ worktreePath: "/wt" });
  });

  it("returns the scoped projectSnapshot result when canonical paths differ", async () => {
    const snapshotMock = vi.fn(async () => ({
      projects: [
        {
          cleanupCommand: "",
          env: {},
          projectRootPath: "/real/repo",
          setupCommand: "",
          updatedAt: 1,
        },
      ],
      version: 1 as const,
      worktreeBindings: [],
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        environments: { snapshot: snapshotMock, worktreeBinding: vi.fn() },
      },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["environment:read"],
    });

    const result = await context.environments.projectSnapshot("/repo-link");

    expect(snapshotMock).toHaveBeenCalledWith({
      projectRootPath: "/repo-link",
    });
    expect(result).toMatchObject({
      projectRootPath: "/real/repo",
    });
  });

  it("returns null from projectSnapshot when no project matches", async () => {
    const snapshotMock = vi.fn(async () => ({
      projects: [],
      version: 1 as const,
      worktreeBindings: [],
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        environments: { snapshot: snapshotMock, worktreeBinding: vi.fn() },
      },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["environment:read"],
    });

    const result = await context.environments.projectSnapshot("/unknown");
    expect(result).toBeNull();
  });
  it("guards external navigation with the plugin capability", async () => {
    const open = vi.fn(async () => ({ opened: true as const }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { externalNavigation: { open } },
    });
    const context = createRendererPluginContext(pluginEntry);

    await expect(
      context.externalNavigation.open("https://example.com")
    ).rejects.toThrow(EXTERNAL_OPEN_CAPABILITY_PATTERN);
    expect(open).not.toHaveBeenCalled();
  });

  it("delegates external navigation after the capability check", async () => {
    const open = vi.fn(async () => ({ opened: true as const }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { externalNavigation: { open } },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["external:open"],
    });

    await expect(
      context.externalNavigation.open("https://example.com/docs")
    ).resolves.toEqual({ opened: true });
    expect(open).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("exposes live appearance and Mermaid rendering through host facades", async () => {
    document.documentElement.style.fontSize = "16px";
    document.documentElement.style.setProperty("--font-sans", "Pier Sans");
    document.documentElement.style.setProperty("--font-mono", "Pier Mono");
    useLocaleStore.setState({ language: "zh-CN" });
    useThemeStore.setState({
      resolvedTheme: "light",
      stylePresetId: "github-default",
    });
    await i18next.changeLanguage("zh-CN");
    const renderMermaid = vi
      .spyOn(mermaidRenderer, "render")
      .mockResolvedValue({ ok: true, svg: "<svg />" });
    const context = createRendererPluginContext(pluginEntry);

    expect(context.appearance.current()).toMatchObject({
      codeTheme: "github-light-default",
      density: "compact",
      language: "zh-CN",
      locale: "zh-CN",
      theme: "light",
      typography: {
        baseFontSize: "16px",
        codeFontFamily: "Pier Mono",
        fontFamily: "Pier Sans",
      },
    });

    const listener = vi.fn();
    const unsubscribe = context.appearance.onDidChange(listener);
    useThemeStore.setState({ resolvedTheme: "dark" });
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        codeTheme: "github-dark-default",
        theme: "dark",
      })
    );
    document.documentElement.style.setProperty("--font-mono", "Next Mono");
    useFontStore.setState({ monoFontFamily: "Next Mono" });
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        typography: expect.objectContaining({ codeFontFamily: "Next Mono" }),
      })
    );
    unsubscribe();
    const calls = listener.mock.calls.length;
    useThemeStore.setState({ resolvedTheme: "light" });
    expect(listener).toHaveBeenCalledTimes(calls);

    await expect(
      context.charts.renderMermaid("graph TD;A-->B")
    ).resolves.toEqual({ ok: true, svg: "<svg />" });
    expect(renderMermaid).toHaveBeenCalledWith("graph TD;A-->B");
  });

  it("acquires a main-owned runtime lease for file preview ticket calls", async () => {
    const acquire = vi.fn(async () => ({
      acquired: true as const,
      leaseId: "runtime-lease-000000000",
      runtimeId: "runtime-id-00000000000",
    }));
    const issue = vi.fn(async () => ({
      expiresAt: 100,
      issued: true as const,
      ticket: "preview-ticket-00000000",
      url: "pier-file-preview://file/preview-ticket-00000000",
    }));
    const release = vi.fn(async () => true);
    const revoke = vi.fn(async () => true);
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { filePreviews: { acquire, issue, release, revoke } },
    });
    const context = createRendererPluginContext({
      ...pluginEntry,
      effectivePermissions: ["file:read"],
    });
    const locator = {
      mime: "image/png",
      path: "image.png",
      revision: "file-v1:a",
      root: "/repo",
    };

    await context.filePreviews.issue(locator, "old-ticket-00000000000");
    await context.filePreviews.release("preview-ticket-00000000");

    expect(acquire).toHaveBeenCalledWith(pluginEntry.manifest.id);
    expect(issue).toHaveBeenCalledWith({
      leaseId: "runtime-lease-000000000",
      locator,
      previousTicket: "old-ticket-00000000000",
    });
    expect(release).toHaveBeenCalledWith({
      leaseId: "runtime-lease-000000000",
      ticket: "preview-ticket-00000000",
    });

    await pluginLifecycleBarriers.prepare(
      pluginEntry.manifest.id,
      "plugin-reload",
      "file-preview-lease-abort-test"
    );
    const waitingIssue = context.filePreviews.issue(locator);
    await pluginLifecycleBarriers.finalize(
      "file-preview-lease-abort-test",
      "abort"
    );
    await expect(waitingIssue).resolves.toMatchObject({ issued: true });
    expect(acquire).toHaveBeenCalledOnce();

    await pluginLifecycleBarriers.prepare(
      pluginEntry.manifest.id,
      "plugin-reload",
      "file-preview-lease-test"
    );
    await pluginLifecycleBarriers.finalize("file-preview-lease-test", "commit");
    expect(revoke).toHaveBeenCalledWith("runtime-lease-000000000");
    await expect(context.filePreviews.issue(locator)).resolves.toEqual({
      issued: false,
      reason: "forbidden",
    });
    expect(acquire).toHaveBeenCalledOnce();
  });
});
