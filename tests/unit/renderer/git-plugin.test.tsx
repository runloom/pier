import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gitRendererPlugin } from "@plugins/builtin/git/renderer/index.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  GIT_PLUGIN_ID,
  type PluginRegistryEntry,
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
import {
  clearPluginPanelsForTests,
  getPluginPanelRegistrations,
} from "@/lib/plugins/plugin-panel-registry.ts";
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
  const commands: PluginRegistryEntry["manifest"]["commands"] = [
    {
      id: "pier.worktree.list",
      permissions: ["worktree:read", "workspace:open"],
      title: "Worktree: List",
    },
    {
      id: "pier.worktree.create",
      permissions: [],
      title: "Worktree: Create",
    },
    {
      id: "pier.worktree.delete",
      permissions: [],
      title: "Worktree: Delete...",
    },
    {
      id: "pier.git.changes.open",
      permissions: ["panel:open"],
      title: "Git: Open Changes",
    },
  ];
  return {
    effectivePermissions: [
      "workspace:open",
      "worktree:read",
      "command:register",
      "panel:register",
      "panel:open",
    ],
    enabled,
    manifest: {
      apiVersion: 1,
      commands,
      engines: { pier: ">=0.1.0" },
      id: GIT_PLUGIN_ID,
      localization: {
        defaultLocale: "en",
        files: {},
        locales: ["en", "zh-CN"],
      },
      locales: {
        en: {
          commands: {
            "pier.git.changes.open": {
              aliases: ["locale git changes"],
              title: "Git: Open Changes",
            },
            "pier.worktree.create": {
              aliases: ["locale worktree create"],
              title: "Worktree: Create",
            },
            "pier.worktree.delete": {
              aliases: ["locale worktree delete"],
              title: "Worktree: Delete...",
            },
            "pier.worktree.list": {
              aliases: ["locale worktree list"],
              title: "Worktree: List",
            },
          },
          messages: {
            "ui.createUnavailable": "Worktree creation is not available yet",
            "ui.current": "current",
            "ui.deleteUnavailable": "Worktree deletion is not available yet",
            "ui.detached": "detached {{head}}",
            "ui.locked": "Locked",
            "ui.main": "main",
            "ui.mainBadge": "main",
            "ui.selectPlaceholder": "Select a worktree...",
            "ui.statusOpenLabel": "Open worktrees for {{name}}",
            "ui.title": "Worktrees",
            "ui.unsupported":
              "Current directory does not support Git worktrees",
          },
        },
        "zh-CN": {
          commands: {
            "pier.git.changes.open": {
              aliases: ["本地化 Git 变更"],
              title: "Git: 打开变更面板",
            },
            "pier.worktree.create": {
              aliases: ["本地化创建工作树"],
              title: "创建工作树",
            },
            "pier.worktree.delete": {
              aliases: ["本地化删除工作树"],
              title: "删除工作树...",
            },
            "pier.worktree.list": {
              aliases: ["本地化工作树列表"],
              title: "工作树列表",
            },
          },
          messages: {
            "ui.createUnavailable": "创建工作树暂未开放",
            "ui.current": "当前",
            "ui.deleteUnavailable": "删除工作树暂未开放",
            "ui.detached": "分离 {{head}}",
            "ui.locked": "已锁定",
            "ui.main": "主工作树",
            "ui.mainBadge": "主工作树",
            "ui.selectPlaceholder": "选择工作树…",
            "ui.statusOpenLabel": "打开 {{name}} 的工作树列表",
            "ui.title": "工作树",
            "ui.unsupported": "当前目录不支持 Git worktree",
          },
        },
      },
      name: "Git",
      panels: [
        {
          id: "pier.git.changes",
          permissions: ["panel:register", "panel:open"],
          title: "Git Changes",
        },
      ],
      permissions: [
        "worktree:read",
        "workspace:open",
        "command:register",
        "panel:register",
        "panel:open",
      ],
      source: { kind: "builtin" },
      terminalStatusItems: [
        {
          id: "pier.worktree.status",
          permissions: ["worktree:read", "workspace:open"],
          title: "Worktree Status",
        },
      ],
      version: "1.0.0",
    },
    runtime: {
      canToggle: true,
      enabled,
      kind: "builtin",
    },
  };
}

describe("git builtin plugin", () => {
  let dispose: (() => void) | null = null;

  function activateWorktreePlugin(): () => void {
    return gitRendererPlugin.activate(
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
        git: {
          getStatus: vi.fn(async () => ({
            branch: {
              ahead: 0,
              behind: 0,
              branch: "main",
              upstream: null,
            },
            files: [],
          })),
          getRepoInfo: vi.fn(async () => ({
            defaultBranch: null,
            gitCommonDir: "/Users/xyz/ABC/pier/.git",
            gitRoot: "/Users/xyz/ABC/pier",
            headOid: "abc123",
            isBare: false,
            isWorktree: false,
          })),
          watch: vi.fn(() => () => undefined),
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    dispose?.();
    dispose = null;
    terminalStatusItemRegistry.clearForTests();
    clearPluginPanelsForTests();
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

  it("启用时注册 git-changes panel 和打开变更命令", () => {
    dispose = activateWorktreePlugin();

    expect(getPluginPanelRegistrations().has("pier.git.changes")).toBe(true);
    expect(actionRegistry.get("pier.git.changes.open")).toBeDefined();
  });

  it("worktree 命令接入命令面板 aliases 搜索模型", () => {
    dispose = activateWorktreePlugin();

    expect(
      actionRegistry.get("pier.worktree.list")?.metadata?.aliases?.()
    ).toEqual(
      expect.arrayContaining(["locale worktree list", "本地化工作树列表"])
    );
    expect(
      actionRegistry.get("pier.worktree.create")?.metadata?.aliases?.()
    ).toEqual(
      expect.arrayContaining(["locale worktree create", "本地化创建工作树"])
    );
    expect(
      actionRegistry.get("pier.worktree.delete")?.metadata?.aliases?.()
    ).toEqual(
      expect.arrayContaining(["locale worktree delete", "本地化删除工作树"])
    );
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

  it("主进程标记 git worktree unsupported 时同步禁用 worktree 命令", () => {
    usePanelDescriptorStore.setState({
      activeId: "terminal-1",
      descriptors: {
        "terminal-1": {
          context: {
            ...context,
            worktreeSupported: false,
          },
          display: { short: "pier" },
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
      badges: expect.arrayContaining([
        expect.objectContaining({ label: "main" }),
      ]),
      checked: true,
      description: "main",
      detail: "/Users/xyz/ABC/pier",
      label: "main",
    });
    expect(linked).toMatchObject({
      detail: "/Users/xyz/ABC/pier-feature",
      label: "feature/worktree",
      searchTerms: expect.arrayContaining([
        "/Users/xyz/ABC/pier-feature",
        "pier-feature",
        "feature/worktree",
        "def456",
      ]),
    });
    expect(locked).toMatchObject({
      badges: expect.arrayContaining([
        expect.objectContaining({ label: "Locked" }),
      ]),
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
        name: "Open worktrees for feature/worktree",
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

  it("不会激活 enabled local 插件的 renderer 代码", async () => {
    const localEntry: PluginRegistryEntry = {
      ...pluginEntry(true),
      enabled: true,
      manifest: {
        ...pluginEntry(true).manifest,
        id: "local.worktree",
        source: { kind: "local" },
      },
      runtime: {
        canToggle: false,
        enabled: false,
        kind: "manifest-only",
      },
    };
    vi.mocked(window.pier.plugins.list).mockResolvedValue({
      diagnostics: [],
      entries: [localEntry],
    } as never);

    await refreshBuiltinPlugins();

    expect(actionRegistry.get("pier.worktree.list")).toBeUndefined();
    expect(terminalStatusItemRegistry.list()).toEqual([]);
  });

  it("renderer builtin catalog owns the git plugin module", () => {
    expect(
      BUILTIN_RENDERER_PLUGIN_MODULES.map((plugin) => plugin.id)
    ).toContain(GIT_PLUGIN_ID);
    expect(gitRendererPlugin.id).toBe(GIT_PLUGIN_ID);
  });

  it("worktree renderer 插件只通过 plugin host API 访问宿主能力", async () => {
    const files = [
      "src/plugins/builtin/git/renderer/worktree-list-action.ts",
      "src/plugins/builtin/git/renderer/git-status-item.tsx",
      "src/plugins/builtin/git/renderer/git-changes-action.ts",
      "src/plugins/builtin/git/renderer/git-changes-panel.tsx",
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
