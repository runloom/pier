import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
      locales: ["en", "zh-CN"],
    },
    locales: {
      en: {
        commands: {
          "sample.list": { title: "Sample: List" },
        },
        messages: {
          "ui.statusOpenLabel": "Open sample for {{name}}",
          "ui.title": "Samples",
        },
      },
      "zh-CN": {
        commands: {
          "sample.list": { title: "示例列表" },
        },
        messages: {
          "ui.statusOpenLabel": "打开 {{name}} 的示例",
          "ui.title": "示例",
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
        aliases: () => ["sample alias"],
        categoryKey: "worktree",
      },
      surfaces: ["command-palette"],
      title: () => "Test Action",
    });

    expect(actionRegistry.get("test.action")?.title()).toBe("Test Action");
    expect(actionRegistry.get("test.action")?.metadata).toMatchObject({
      categoryKey: "worktree",
    });
    expect(actionRegistry.get("test.action")?.metadata?.aliases?.()).toEqual([
      "sample alias",
    ]);

    dispose();
    expect(actionRegistry.get("test.action")).toBeUndefined();
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
    const open = vi.fn(async () => ({
      panelId: "terminal-worktree",
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        worktrees: { check, list, open },
      },
    });

    const context = createRendererPluginContext();

    await context.worktrees.check({ path: "/repo" });
    await context.worktrees.list({ path: "/repo" });
    await context.worktrees.open({ path: "/repo" });

    expect(check).toHaveBeenCalledWith({ path: "/repo" });
    expect(list).toHaveBeenCalledWith({ path: "/repo" });
    expect(open).toHaveBeenCalledWith({ path: "/repo" });
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
