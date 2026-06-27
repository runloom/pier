import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { worktreeRendererPlugin } from "@plugins/builtin/worktree/renderer/index.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  type PluginRegistryEntry,
  WORKTREE_PLUGIN_ID,
} from "@shared/contracts/plugin.ts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { refreshBuiltinPlugins } from "@/lib/plugins/bootstrap.ts";
import { BUILTIN_RENDERER_PLUGIN_MODULES } from "@/lib/plugins/builtin-catalog.ts";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";
import { terminalStatusItemRegistry } from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";

const now = 1_772_000_000_000;

const context: PanelContext = {
  branch: "main",
  contextId: "ctx-pier",
  cwd: "/Users/xyz/ABC/pier",
  gitRoot: "/Users/xyz/ABC/pier",
  openedPath: "/Users/xyz/ABC/pier",
  projectRoot: "/Users/xyz/ABC/pier",
  source: "panel",
  updatedAt: now,
  worktreeKey: "/Users/xyz/ABC/pier",
  worktreeRoot: "/Users/xyz/ABC/pier",
};

function pluginEntry(enabled: boolean): PluginRegistryEntry {
  const commands: PluginRegistryEntry["commands"] = [
    {
      id: "pier.worktree.list",
      permissions: ["worktree:read", "workspace:open"],
      title: "Worktree: List",
    },
    {
      id: "pier.worktree.create",
      permissions: ["worktree:write"],
      title: "Worktree: Create",
    },
    {
      id: "pier.worktree.delete",
      permissions: ["worktree:write"],
      title: "Worktree: Delete...",
    },
  ];
  return {
    commands,
    enabled,
    id: WORKTREE_PLUGIN_ID,
    manifest: {
      apiVersion: 1,
      commands,
      engines: { pier: ">=0.1.0" },
      id: WORKTREE_PLUGIN_ID,
      localization: {
        defaultLocale: "en",
        files: {},
        locales: ["en", "zh-CN"],
      },
      locales: {
        en: {
          commands: {
            "pier.worktree.create": { title: "Worktree: Create" },
            "pier.worktree.delete": { title: "Worktree: Delete..." },
            "pier.worktree.list": { title: "Worktree: List" },
          },
          messages: {
            "ui.createUnavailable": "Worktree creation is not available yet",
            "ui.deleteUnavailable": "Worktree deletion is not available yet",
            "ui.locked": "Locked",
            "ui.main": "main",
            "ui.mainWithBranch": "main ({{branch}})",
            "ui.selectPlaceholder": "Select a worktree...",
            "ui.statusOpenLabel": "Open worktrees for {{name}}",
            "ui.title": "Worktrees",
            "ui.unsupported":
              "Current directory does not support Git worktrees",
          },
        },
        "zh-CN": {
          commands: {
            "pier.worktree.create": { title: "创建工作树" },
            "pier.worktree.delete": { title: "删除工作树..." },
            "pier.worktree.list": { title: "工作树列表" },
          },
          messages: {
            "ui.createUnavailable": "创建工作树暂未开放",
            "ui.deleteUnavailable": "删除工作树暂未开放",
            "ui.locked": "已锁定",
            "ui.main": "主工作树",
            "ui.mainWithBranch": "主工作树（{{branch}}）",
            "ui.selectPlaceholder": "选择工作树…",
            "ui.statusOpenLabel": "打开 {{name}} 的工作树列表",
            "ui.title": "工作树",
            "ui.unsupported": "当前目录不支持 Git worktree",
          },
        },
      },
      name: "Worktree",
      panels: [],
      permissions: ["worktree:read", "workspace:open", "command:register"],
      source: { kind: "builtin" },
      version: "1.0.0",
    },
    panels: [],
    permissions: ["worktree:read", "workspace:open", "command:register"],
    source: { kind: "builtin" },
    version: "1.0.0",
  };
}

describe("worktree builtin plugin", () => {
  let dispose: (() => void) | null = null;

  function activateWorktreePlugin(): () => void {
    return worktreeRendererPlugin.activate(
      createRendererPluginContext(pluginEntry(true))
    );
  }

  beforeEach(async () => {
    await initI18n();
    await i18next.changeLanguage("en");
    useCommandPaletteController.setState({
      mode: "commands",
      open: false,
      quickPick: null,
      requestId: 0,
      stack: [],
    });
    usePanelDescriptorStore.setState({
      activeId: "terminal-1",
      descriptors: {
        "terminal-1": {
          context,
          display: { short: "pier" },
        },
      },
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        plugins: {
          inspect: vi.fn(async () => pluginEntry(true)),
          list: vi.fn(async () => ({
            diagnostics: [],
            entries: [pluginEntry(true)],
          })),
        },
        worktrees: {
          check: vi.fn(async () => ({
            currentPath: "/Users/xyz/ABC/pier",
            mainPath: "/Users/xyz/ABC/pier",
            path: "/Users/xyz/ABC/pier",
            status: "supported",
          })),
          list: vi.fn(async () => ({
            currentPath: "/Users/xyz/ABC/pier",
            mainPath: "/Users/xyz/ABC/pier",
            path: "/Users/xyz/ABC/pier",
            status: "available",
            worktrees: [
              {
                bare: false,
                branch: "main",
                detached: false,
                head: "abc123",
                isCurrent: true,
                isMain: true,
                locked: false,
                lockedReason: null,
                path: "/Users/xyz/ABC/pier",
                prunable: false,
                prunableReason: null,
              },
              {
                bare: false,
                branch: "feature/worktree",
                detached: false,
                head: "def456",
                isCurrent: false,
                isMain: false,
                locked: false,
                lockedReason: null,
                path: "/Users/xyz/ABC/pier-feature",
                prunable: false,
                prunableReason: null,
              },
              {
                bare: false,
                branch: "locked/worktree",
                detached: false,
                head: "fed789",
                isCurrent: false,
                isMain: false,
                locked: true,
                lockedReason: "used by another process",
                path: "/Users/xyz/ABC/pier-locked",
                prunable: false,
                prunableReason: null,
              },
              {
                bare: false,
                branch: "stale/worktree",
                detached: false,
                head: "fed789",
                isCurrent: false,
                isMain: false,
                locked: false,
                lockedReason: null,
                path: "/Users/xyz/ABC/pier-stale",
                prunable: true,
                prunableReason: "missing gitdir",
              },
            ],
          })),
          open: vi.fn(async () => ({ context, panelId: "terminal-worktree" })),
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    dispose?.();
    dispose = null;
    terminalStatusItemRegistry.clearForTests();
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    vi.restoreAllMocks();
  });

  it("启用时注册命令面板动作和终端状态栏项", () => {
    dispose = activateWorktreePlugin();

    expect(actionRegistry.get("pier.worktree.list")).toBeDefined();
    expect(actionRegistry.get("pier.worktree.create")).toBeDefined();
    expect(actionRegistry.get("pier.worktree.delete")).toBeDefined();
    expect(actionRegistry.get("pier.worktree.switch")).toBeUndefined();
    expect(
      terminalStatusItemRegistry
        .list()
        .map((item) => item.id)
        .includes("pier.worktree.status")
    ).toBe(true);
  });

  it("禁用时不注册任何 renderer 贡献", async () => {
    vi.mocked(window.pier.plugins.list).mockResolvedValueOnce({
      diagnostics: [],
      entries: [pluginEntry(false)],
    } as never);

    await refreshBuiltinPlugins();

    expect(actionRegistry.get("pier.worktree.list")).toBeUndefined();
    expect(actionRegistry.get("pier.worktree.create")).toBeUndefined();
    expect(actionRegistry.get("pier.worktree.delete")).toBeUndefined();
    expect(terminalStatusItemRegistry.list()).toEqual([]);
  });

  it("Create 和 Delete 入口本期展示但禁用", () => {
    dispose = activateWorktreePlugin();

    expect(actionRegistry.get("pier.worktree.create")?.enabled?.()).toBe(false);
    expect(actionRegistry.get("pier.worktree.create")?.disabledReason?.()).toBe(
      "Worktree creation is not available yet"
    );
    expect(actionRegistry.get("pier.worktree.delete")?.enabled?.()).toBe(false);
    expect(actionRegistry.get("pier.worktree.delete")?.disabledReason?.()).toBe(
      "Worktree deletion is not available yet"
    );
  });

  it("worktree 命令入口和禁用原因支持中文国际化", async () => {
    await i18next.changeLanguage("zh-CN");
    dispose = activateWorktreePlugin();

    expect(actionRegistry.get("pier.worktree.list")?.title()).toBe(
      "工作树列表"
    );
    expect(actionRegistry.get("pier.worktree.create")?.title()).toBe(
      "创建工作树"
    );
    expect(actionRegistry.get("pier.worktree.create")?.disabledReason?.()).toBe(
      "创建工作树暂未开放"
    );
    expect(actionRegistry.get("pier.worktree.delete")?.title()).toBe(
      "删除工作树..."
    );
    expect(actionRegistry.get("pier.worktree.delete")?.disabledReason?.()).toBe(
      "删除工作树暂未开放"
    );
  });

  it("非 Git 上下文禁用 worktree 命令", () => {
    usePanelDescriptorStore.setState({
      activeId: "terminal-1",
      descriptors: {
        "terminal-1": {
          context: {
            contextId: "ctx-home",
            cwd: "/Users/xyz",
            openedPath: "/Users/xyz",
            source: "panel",
            updatedAt: now,
          },
          display: { short: "xyz" },
        },
      },
    });
    dispose = activateWorktreePlugin();

    expect(actionRegistry.get("pier.worktree.list")?.enabled?.()).toBe(false);
    expect(actionRegistry.get("pier.worktree.list")?.disabledReason?.()).toBe(
      "Current directory does not support Git worktrees"
    );
  });

  it("命令面板动作按 LoomDesk 列表形态列出 worktree 并打开目标 worktree", async () => {
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.worktree.list")?.handler();

    expect(window.pier.worktrees.list).toHaveBeenCalledWith({
      path: "/Users/xyz/ABC/pier",
    });
    const quickPick = useCommandPaletteController.getState().quickPick;
    expect(quickPick).toMatchObject({
      placeholder: "Select a worktree...",
      title: "Worktrees",
    });
    const linked = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "worktree:/Users/xyz/ABC/pier-feature");
    const main = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "worktree:/Users/xyz/ABC/pier");
    const locked = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "worktree:/Users/xyz/ABC/pier-locked");
    const prunable = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "worktree:/Users/xyz/ABC/pier-stale");
    expect(main).toMatchObject({
      checked: true,
      detail: "/Users/xyz/ABC/pier",
      label: "main (main)",
    });
    expect(linked).toMatchObject({
      detail: "/Users/xyz/ABC/pier-feature",
      label: "feature/worktree",
    });
    expect(locked).toMatchObject({
      description: "used by another process",
      disabled: false,
      label: "locked/worktree",
    });
    expect(prunable).toBeUndefined();

    if (!(quickPick && linked)) {
      throw new Error("expected linked worktree item");
    }
    await quickPick.onAccept(linked);

    expect(window.pier.worktrees.open).toHaveBeenCalledWith({
      path: "/Users/xyz/ABC/pier-feature",
    });
  });

  it("终端状态栏使用自身 panel context 打开 worktree 列表", async () => {
    dispose = activateWorktreePlugin();
    const statusItem = terminalStatusItemRegistry
      .list()
      .find((item) => item.id === "pier.worktree.status");
    if (!statusItem) {
      throw new Error("expected worktree status item");
    }

    render(
      statusItem.render({
        context: {
          ...context,
          branch: "feature/worktree",
          cwd: "/Users/xyz/ABC/pier-feature/src",
          gitRoot: "/Users/xyz/ABC/pier-feature",
          projectRoot: "/Users/xyz/ABC/pier-feature",
          worktreeRoot: "/Users/xyz/ABC/pier-feature",
        },
        cwd: "/Users/xyz/ABC/pier-feature/src",
        panelId: "terminal-feature",
        title: null,
      })
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open worktrees for pier-feature",
      })
    );

    await waitFor(() => {
      expect(window.pier.worktrees.check).toHaveBeenCalledWith({
        path: "/Users/xyz/ABC/pier-feature",
      });
    });
  });

  it("终端状态栏在非 Git context 下不渲染 worktree 入口", () => {
    dispose = activateWorktreePlugin();
    const statusItem = terminalStatusItemRegistry
      .list()
      .find((item) => item.id === "pier.worktree.status");
    if (!statusItem) {
      throw new Error("expected worktree status item");
    }

    const { container } = render(
      statusItem.render({
        context: {
          contextId: "ctx-home",
          cwd: "/Users/xyz",
          openedPath: "/Users/xyz",
          source: "panel",
          updatedAt: now,
        },
        cwd: "/Users/xyz",
        panelId: "terminal-home",
        title: null,
      })
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("runtime 刷新会替换贡献而不会误删新注册的 action", async () => {
    vi.mocked(window.pier.plugins.list).mockResolvedValue({
      diagnostics: [],
      entries: [pluginEntry(true)],
    } as never);

    await refreshBuiltinPlugins();
    expect(actionRegistry.get("pier.worktree.list")).toBeDefined();

    await refreshBuiltinPlugins();
    expect(actionRegistry.get("pier.worktree.list")).toBeDefined();

    vi.mocked(window.pier.plugins.list).mockResolvedValue({
      diagnostics: [],
      entries: [pluginEntry(false)],
    } as never);
    await refreshBuiltinPlugins();
    expect(actionRegistry.get("pier.worktree.list")).toBeUndefined();
  });

  it("renderer builtin catalog owns the worktree plugin module", () => {
    expect(
      BUILTIN_RENDERER_PLUGIN_MODULES.map((plugin) => plugin.id)
    ).toContain(WORKTREE_PLUGIN_ID);
    expect(worktreeRendererPlugin.id).toBe(WORKTREE_PLUGIN_ID);
  });

  it("worktree renderer 插件只通过 plugin host API 访问宿主能力", async () => {
    const files = [
      "src/plugins/builtin/worktree/renderer/worktree-list-action.ts",
      "src/plugins/builtin/worktree/renderer/worktree-status-item.tsx",
    ];
    const source = (
      await Promise.all(
        files.map((file) => readFile(join(process.cwd(), file), "utf8"))
      )
    ).join("\n");

    expect(source).not.toContain("../../../../renderer/panel-kits/");
    expect(source).not.toContain("../../../../renderer/lib/actions/");
    expect(source).not.toContain("../../../../renderer/lib/command-palette/");
    expect(source).not.toContain("../../../../renderer/stores/");
  });
});
