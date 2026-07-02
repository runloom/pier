import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "toast-1"),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";
import { terminalStatusItemRegistry } from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";

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
  terminalStatusItemRegistry.clearForTests();
  useCommandPaletteController.setState({
    mode: "commands",
    open: false,
    quickPick: null,
    requestId: 0,
    stack: [],
  });
  usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
  vi.restoreAllMocks();
});

describe("createRendererPluginContext", () => {
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
