import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { DockviewApi } from "dockview-react";
import i18next from "i18next";
import { House } from "lucide-react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const FILE_WRITE_CAPABILITY_PATTERN = /file:write/;
const GIT_READ_CAPABILITY_PATTERN = /git:read/;
const GIT_WRITE_CAPABILITY_PATTERN = /git:write/;

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
import { clearPluginPanelsForTests } from "@/lib/plugins/plugin-panel-registry.ts";
import { terminalStatusItemRegistry } from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const panelContext: PanelContext = {
  branch: "main",
  contextId: "ctx-pier",
  cwd: "/Users/xyz/ABC/pier",
  gitRoot: "/Users/xyz/ABC/pier",
  openedPath: "/Users/xyz/ABC/pier",
  projectRoot: "/Users/xyz/ABC/pier",
  source: "panel",
  updatedAt: 1_772_000_000_000,
  worktreeKey: "/Users/xyz/ABC/pier",
  worktreeRoot: "/Users/xyz/ABC/pier",
};

interface ExpectedFilesFacade {
  list(request: { path: string; root: string }): Promise<unknown>;
  move(request: {
    newPath: string;
    path: string;
    root: string;
  }): Promise<unknown>;
  readText(request: { path: string; root: string }): Promise<string>;
  rename(request: {
    newPath: string;
    path: string;
    root: string;
  }): Promise<unknown>;
  trash(request: { path: string; root: string }): Promise<unknown>;
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
const undeclaredContributionErrorPattern = /not declared/;

const pluginEntry = {
  effectivePermissions: [],
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
    permissions: [],
    source: { kind: "builtin" },
    terminalStatusItems: sampleTerminalStatusItems,
    version: "1.0.0",
  },
  runtime: {
    canToggle: true,
    enabled: true,
    kind: "builtin",
  },
} satisfies PluginRegistryEntry;

beforeAll(async () => {
  await initI18n();
});

afterEach(() => {
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
});

describe("createRendererPluginContext", () => {
  it("delegates terminal status item registration to the internal registry", () => {
    const context = createRendererPluginContext();

    const dispose = context.terminalStatusItems.register({
      id: "test.status",
      order: 20,
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
    await context.worktrees.create({
      branch: "feature/new",
      name: "new",
      path: "/repo",
    });
    await context.worktrees.list({ path: "/repo" });
    await context.worktrees.open({ path: "/repo" });
    await context.worktrees.prune({ path: "/repo" });
    await context.worktrees.remove({ path: "/repo/.worktrees/new" });

    expect(check).toHaveBeenCalledWith({ path: "/repo" });
    expect(create).toHaveBeenCalledWith({
      branch: "feature/new",
      name: "new",
      path: "/repo",
    });
    expect(list).toHaveBeenCalledWith({ path: "/repo" });
    expect(open).toHaveBeenCalledWith({ path: "/repo" });
    expect(prune).toHaveBeenCalledWith({ path: "/repo" });
    expect(remove).toHaveBeenCalledWith({ path: "/repo/.worktrees/new" });
  });

  it("delegates file methods to the preload facade", async () => {
    const root = "/repo";
    const list = vi.fn(async () => [
      { kind: "file", path: "src/index.ts", root },
    ]);
    const readText = vi.fn(async () => "export const value = 1;\n");
    const writeText = vi.fn(async () => ({ written: true }));
    const rename = vi.fn(async () => ({ renamed: true }));
    const move = vi.fn(async () => ({ moved: true }));
    const trash = vi.fn(async () => ({ trashed: true }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        files: { list, move, readText, rename, trash, writeText },
      },
    });
    const context = createRendererPluginContext() as RendererPluginContext & {
      files: ExpectedFilesFacade;
    };

    await expect(context.files.list({ path: "src", root })).resolves.toEqual([
      { kind: "file", path: "src/index.ts", root },
    ]);
    await expect(
      context.files.readText({ path: "src/index.ts", root })
    ).resolves.toBe("export const value = 1;\n");
    await expect(
      context.files.writeText({
        contents: "export const value = 2;\n",
        path: "src/index.ts",
        root,
      })
    ).resolves.toEqual({ written: true });
    await expect(
      context.files.rename({
        newPath: "src/main.ts",
        path: "src/index.ts",
        root,
      })
    ).resolves.toEqual({ renamed: true });
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
    expect(writeText).toHaveBeenCalledWith({
      contents: "export const value = 2;\n",
      path: "src/index.ts",
      root,
    });
    expect(rename).toHaveBeenCalledWith({
      newPath: "src/main.ts",
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
    const writeText = vi.fn(async () => ({ written: true }));
    const rename = vi.fn(async () => ({ renamed: true }));
    const move = vi.fn(async () => ({ moved: true }));
    const trash = vi.fn(async () => ({ trashed: true }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        files: { list, move, readText, rename, trash, writeText },
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
        context.files.rename({
          newPath: "src/main.ts",
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
    expect(rename).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(trash).not.toHaveBeenCalled();
  });

  it("allows file plugins with write permission to invoke mutation methods", async () => {
    const root = "/repo";
    const list = vi.fn(async () => []);
    const readText = vi.fn(async () => "");
    const writeText = vi.fn(async () => ({ written: true }));
    const rename = vi.fn(async () => ({ renamed: true }));
    const move = vi.fn(async () => ({ moved: true }));
    const trash = vi.fn(async () => ({ trashed: true }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        files: { list, move, readText, rename, trash, writeText },
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
    ).resolves.toEqual({ written: true });
    await expect(
      context.files.rename({
        newPath: "src/main.ts",
        path: "src/index.ts",
        root,
      })
    ).resolves.toEqual({ renamed: true });
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
    expect(rename).toHaveBeenCalledWith({
      newPath: "src/main.ts",
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
      rebase: vi.fn(async () => ({ status: "rebased" })),
      searchBranches: vi.fn(async () => ({ branches: [] })),
      stage: vi.fn(async () => true),
      stash: vi.fn(async () => ({ status: "stashed" })),
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
      () => context.git.rebase("/repo", "main"),
      () => context.git.stage("/repo", ["README.md"]),
      () => context.git.stash("/repo"),
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
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        git: {
          discardChanges,
          getDiffPatch,
          getFileContent,
          stage,
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
  });

  it("delegates plain notifications to the host toast layer", () => {
    const context = createRendererPluginContext();

    context.notifications.success("Merged", { description: "1 file changed" });
    context.notifications.info("Nothing to stash");
    context.notifications.error("No active git panel");

    expect(toastMocks.success).toHaveBeenCalledWith("Merged", {
      description: "1 file changed",
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
});
