import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { TerminalOverlayContext } from "@pier/ui/use-terminal-overlay.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FILES_PLUGIN_MANIFEST } from "@plugins/builtin/files/manifest.ts";
import { GIT_PLUGIN_ID } from "@plugins/builtin/git/manifest.ts";
import { gitRendererPlugin } from "@plugins/builtin/git/renderer/index.ts";
import type { GitDiffBranchOption } from "@shared/contracts/git.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { IDockviewPanelProps } from "dockview-react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDialogHost } from "@/components/common/app-dialog-host.tsx";
import { initI18n } from "@/i18n/index.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { useCommandPaletteController } from "@/lib/command-palette/controller.ts";
import { BUILTIN_RENDERER_PLUGIN_MODULES } from "@/lib/plugins/builtin-catalog.ts";
import { createRendererPluginContext } from "@/lib/plugins/host-context.ts";
import {
  clearPluginPanelsForTests,
  getPluginPanelRegistrations,
} from "@/lib/plugins/plugin-panel-registry.ts";
import { RendererPluginRuntime } from "@/lib/plugins/runtime.ts";
import { getLastTerminalHostSnapshot } from "@/lib/workspace/terminal-host-state-reconciler.ts";
import { terminalStatusItemRegistry } from "@/panel-kits/terminal/terminal-status-bar.tsx";
import { resetAppDialogForTests } from "@/stores/app-dialog.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { usePanelDescriptorStore } from "@/stores/panel-descriptor.store.ts";
import { usePluginOverlayStore } from "@/stores/plugin-overlay.store.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import {
  registerTerminalElementWebOverlay,
  resetTerminalInputRoutingForTests,
} from "@/stores/terminal-input-routing-slice.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const toastMocks = vi.hoisted(() => ({
  dismiss: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "git-loading-toast"),
  success: vi.fn(),
}));
const terminalOverlayRegistry = {
  registerElement: registerTerminalElementWebOverlay,
};

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

const now = 1_772_000_000_000;
const FILES_PLUGIN_ID = "pier.files";
const FILES_FILE_PANEL_ID = "pier.files.filePanel";
const APP_TSX_TREEITEM_PATTERN = /App\.tsx/;
const NESTED_TREEITEM_PATTERN = /nested/;
const DEEP_A_TS_TREEITEM_PATTERN = /deep-a\.ts/;
const DEEP_B_TS_TREEITEM_PATTERN = /deep-b\.ts/;
const SRC_PERMISSION_LOAD_ERROR_PATTERN =
  /Permission denied loading src|error/i;

function getPierFileTree(container: HTMLElement): HTMLElement {
  const host = container.querySelector(
    'file-tree-container[data-slot="pier-file-tree"]'
  );

  expect(host).toBeInstanceOf(HTMLElement);
  const tree = (host as HTMLElement).shadowRoot?.querySelector('[role="tree"]');

  expect(tree).toBeInstanceOf(HTMLElement);
  return tree as HTMLElement;
}

/** 分支名不应再带 max-w-[...] 固定宽度上限（只在容器溢出时 truncate）。 */
const FIXED_MAX_WIDTH_CLASS_RE = /max-w-\[/;
const DROP_STASH_CONFIRM_BODY_RE = /Drop stash@\{2\}\? This cannot be undone\./;

const context: PanelContext = {
  branch: "main",
  contextId: "ctx-pier",
  cwd: "/Users/xyz/ABC/pier",
  gitRoot: "/Users/xyz/ABC/pier",
  openedPath: "/Users/xyz/ABC/pier",
  projectRootPath: "/Users/xyz/ABC/pier",
  source: "panel",
  updatedAt: now,
  worktreeKey: "/Users/xyz/ABC/pier",
  worktreeRoot: "/Users/xyz/ABC/pier",
};

function branchOption(
  overrides: Pick<GitDiffBranchOption, "kind" | "name" | "refName"> &
    Partial<GitDiffBranchOption>
): GitDiffBranchOption {
  return {
    aheadFromCurrent: null,
    authorName: null,
    behindFromCurrent: null,
    commit: "abc1234567",
    committerDate: null,
    current: false,
    id: overrides.refName,
    label: overrides.name,
    pinReason: null,
    subject: null,
    tipTreeInCurrentHistory: null,
    ...overrides,
  };
}

function pluginEntry(enabled: boolean): PluginRegistryEntry {
  const commands: PluginRegistryEntry["manifest"]["commands"] = [
    {
      id: "pier.worktree.list",
      permissions: ["worktree:read", "workspace:open"],
      title: "List Worktrees",
    },
    {
      id: "pier.worktree.create",
      permissions: ["worktree:write", "environment:read"],
      title: "Create Worktree",
    },
    {
      id: "pier.worktree.delete",
      permissions: ["worktree:read", "worktree:write", "environment:read"],
      title: "Delete Worktrees...",
    },
    {
      id: "pier.worktree.prune",
      permissions: ["worktree:read", "worktree:write"],
      title: "Prune Stale Worktrees",
    },
    {
      id: "pier.git.switchBranch",
      permissions: ["git:read", "git:write"],
      title: "Git: Switch Branch...",
    },
    {
      id: "pier.git.merge",
      permissions: ["git:read", "git:write"],
      title: "Git: Merge Branch...",
    },
    {
      id: "pier.git.mergeAbort",
      permissions: ["git:write"],
      title: "Git: Abort Merge",
    },
    {
      id: "pier.git.stashApply",
      permissions: ["git:read", "git:write"],
      title: "Git: Apply Stash...",
    },
    {
      id: "pier.git.stashDrop",
      permissions: ["git:read", "git:write"],
      title: "Git: Drop Stash...",
    },
    {
      id: "pier.git.stashIncludeUntracked",
      permissions: ["git:write"],
      title: "Git: Stash (Include Untracked)",
    },
    {
      id: "pier.git.stash",
      permissions: ["git:write"],
      title: "Git: Stash",
    },
    {
      id: "pier.git.stashPop",
      permissions: ["git:read", "git:write"],
      title: "Git: Pop Stash...",
    },
    {
      id: "pier.git.rebase",
      permissions: ["git:read", "git:write"],
      title: "Git: Rebase Branch...",
    },
    {
      id: "pier.git.rebaseAbort",
      permissions: ["git:write"],
      title: "Git: Abort Rebase",
    },
    {
      id: "pier.git.rebaseContinue",
      permissions: ["git:write"],
      title: "Git: Continue Rebase",
    },
    {
      id: "pier.git.undoLastCommit",
      permissions: ["git:write"],
      title: "Git: Undo Last Commit",
    },
  ];
  return {
    effectivePermissions: [
      "workspace:open",
      "worktree:read",
      "worktree:write",
      "environment:read",
      "command:register",
      "git:read",
      "git:write",
    ],
    enabled,
    manifest: {
      apiVersion: 1,
      commands,
      configuration: {
        properties: {
          "pier.git.statusItem.showDirtyIndicator": {
            default: true,
            type: "boolean",
          },
        },
      },
      workbenchWidgets: [],
      settingsPages: [],
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
            "pier.git.merge": {
              aliases: ["locale git merge"],
              title: "Git: Merge Branch...",
            },
            "pier.git.switchBranch": {
              aliases: ["locale git switch branch"],
              title: "Git: Switch Branch...",
            },
            "pier.git.mergeAbort": {
              aliases: ["locale git merge abort"],
              title: "Git: Abort Merge",
            },
            "pier.git.stash": {
              aliases: ["locale git stash"],
              title: "Git: Stash",
            },
            "pier.git.stashPop": {
              aliases: ["locale git stash pop"],
              title: "Git: Pop Stash...",
            },
            "pier.git.rebase": {
              aliases: ["locale git rebase"],
              title: "Git: Rebase Branch...",
            },
            "pier.git.rebaseAbort": {
              aliases: ["locale git rebase abort"],
              title: "Git: Abort Rebase",
            },
            "pier.git.rebaseContinue": {
              aliases: ["locale git rebase continue"],
              title: "Git: Continue Rebase",
            },
            "pier.git.undoLastCommit": {
              aliases: ["locale git undo commit"],
              title: "Git: Undo Last Commit",
            },
            "pier.worktree.create": {
              aliases: ["locale worktree create"],
              title: "Create Worktree",
            },
            "pier.worktree.delete": {
              aliases: ["locale worktree delete"],
              title: "Delete Worktrees...",
            },
            "pier.worktree.list": {
              aliases: ["locale worktree list"],
              title: "List Worktrees",
            },
            "pier.worktree.prune": {
              aliases: ["locale worktree prune"],
              title: "Prune Stale Worktrees",
            },
          },
          messages: {
            "ui.createUnavailable": "Worktree creation is not available yet",
            "ui.cancel": "Cancel",
            "ui.createBranchPrompt": "New branch name",
            "ui.createNamePrompt": "New worktree name",
            "ui.current": "current",
            "ui.deleteUnavailable": "Worktree deletion is not available yet",
            "ui.deleteConfirm": "Delete worktree {{name}}?",
            "ui.deleteConfirmButton": "Delete",
            "ui.deletePlaceholder": "Select a worktree",
            "ui.detached": "detached {{head}}",
            "ui.gitMergeAlreadyUpToDate":
              "Branch {{branch}} has no new commits to merge.",
            "ui.gitMergeSelectBranch":
              "Select a branch to merge into the current branch",
            "ui.gitMergeSuccess": "Successfully merged branch {{branch}}",
            "ui.gitNoOtherBranches": "No other branches found",
            "ui.gitStashListEmpty": "No stashes found",
            "ui.gitStashPopSuccess": "Stash applied and removed",
            "ui.gitStashSelect": "Select a stash to pop",
            "ui.gitStashSuccess": "Changes stashed",
            "ui.locked": "Locked",
            "ui.main": "main",
            "ui.mainBadge": "main",
            "ui.noPrunableWorktrees": "No stale worktrees found",
            "ui.noWorktreeToDelete": "No worktree can be deleted",
            "ui.pruneConfirm": "Prune stale worktree entries?",
            "ui.pruneConfirmButton": "Prune",
            "ui.selectPlaceholder": "Select a worktree...",
            "ui.statusOpenLabel": "Open worktrees for {{name}}",
            "ui.title": "Worktrees",
            "ui.unsupported":
              "Current directory does not support Git worktrees",
            "ui.worktreeCreateSuccess": "Worktree created",
            "ui.worktreeDeleteSuccess": "Worktree deleted",
            "ui.worktreePruneSuccess": "Stale worktrees pruned",
          },
        },
        "zh-CN": {
          commands: {
            "pier.git.merge": {
              aliases: ["本地化合并分支"],
              title: "Git: 合并分支...",
            },
            "pier.git.switchBranch": {
              aliases: ["本地化切换分支"],
              title: "Git: 切换分支...",
            },
            "pier.git.mergeAbort": {
              aliases: ["本地化中止合并"],
              title: "Git: 中止合并",
            },
            "pier.git.stash": {
              aliases: ["本地化暂存更改"],
              title: "Git: 暂存更改",
            },
            "pier.git.stashPop": {
              aliases: ["本地化弹出暂存"],
              title: "Git: 弹出暂存...",
            },
            "pier.git.rebase": {
              aliases: ["本地化变基"],
              title: "Git: 变基到分支...",
            },
            "pier.git.rebaseAbort": {
              aliases: ["本地化中止变基"],
              title: "Git: 中止变基",
            },
            "pier.git.rebaseContinue": {
              aliases: ["本地化继续变基"],
              title: "Git: 继续变基",
            },
            "pier.git.undoLastCommit": {
              aliases: ["本地化撤销提交"],
              title: "Git: 撤销上次提交",
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
            "pier.worktree.prune": {
              aliases: ["本地化清理工作树"],
              title: "清理工作树",
            },
          },
          messages: {
            "ui.createUnavailable": "创建工作树暂未开放",
            "ui.cancel": "取消",
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
      panels: [],
      permissions: [
        "worktree:read",
        "worktree:write",
        "workspace:open",
        "command:register",
        "git:read",
        "git:write",
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
function filesPluginEntry(enabled: boolean): PluginRegistryEntry {
  // 直接用真 manifest,避免测试内联副本与插件命令表漂移。
  return {
    effectivePermissions: [...FILES_PLUGIN_MANIFEST.permissions],
    enabled,
    manifest: FILES_PLUGIN_MANIFEST,
    runtime: {
      canToggle: true,
      enabled,
      kind: "builtin",
    },
  };
}

function makeFilesPanelProps(
  params: Record<string, unknown>
): IDockviewPanelProps<Record<string, unknown>> {
  return {
    api: {
      id: FILES_FILE_PANEL_ID,
      setTitle: vi.fn(),
      updateParameters: vi.fn(),
    },
    containerApi: {},
    params,
  } as unknown as IDockviewPanelProps<Record<string, unknown>>;
}

function renderFilesFilePanel(list: RendererPluginContext["files"]["list"]) {
  const filesModule = BUILTIN_RENDERER_PLUGIN_MODULES.find(
    (plugin) => plugin.id === FILES_PLUGIN_ID
  );
  expect(filesModule).toBeDefined();
  if (!filesModule) {
    throw new Error("expected Files renderer plugin module in builtin catalog");
  }

  const baseFilesContext = createRendererPluginContext(filesPluginEntry(true));
  const filesContext: RendererPluginContext = {
    ...baseFilesContext,
    files: { ...baseFilesContext.files, list },
  };
  const disposeFiles = filesModule.activate(filesContext);
  const registration = getPluginPanelRegistrations().get(FILES_FILE_PANEL_ID);
  const FilesPanel = registration?.component;
  if (!FilesPanel) {
    disposeFiles();
    throw new Error("expected Files file-panel registration");
  }

  return {
    ...render(<FilesPanel {...makeFilesPanelProps({ context })} />),
    disposeFiles,
  };
}

describe("git builtin plugin", () => {
  let dispose: (() => void) | null = null;
  let rendererPluginRuntime: RendererPluginRuntime;

  function activateWorktreePlugin(): () => void {
    render(
      <TerminalOverlayContext.Provider value={terminalOverlayRegistry}>
        <AppDialogHost />
      </TerminalOverlayContext.Provider>
    );
    return gitRendererPlugin.activate(
      createRendererPluginContext(pluginEntry(true))
    );
  }

  beforeEach(async () => {
    rendererPluginRuntime = new RendererPluginRuntime();
    vi.clearAllMocks();
    resetTerminalInputRoutingForTests();
    await initI18n();
    await i18next.changeLanguage("en");
    useKeybindingScope.setState({
      activePanelComponent: null,
      activePanelId: null,
      activePanelKind: null,
      overlayStack: [],
    });
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
    usePluginRegistryStore.setState({
      diagnostics: [],
      error: null,
      initialized: true,
      plugins: [pluginEntry(true)],
    });
    usePluginSettingsStore.setState({
      error: null,
      initialized: true,
      values: {},
    });
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        files: {
          exists: vi.fn(async () => ({ exists: true })),
          list: vi.fn(async () => []),
          mkdir: vi.fn(async () => ({ created: true })),
          move: vi.fn(async () => ({ moved: true })),
          readText: vi.fn(async () => ""),
          stat: vi.fn(async () => ({
            exists: true,
            isDirectory: false,
            mtimeMs: 1,
            size: 0,
          })),
          trash: vi.fn(async () => ({ trashed: true })),
          watch: vi.fn(() => vi.fn()),
          writeText: vi.fn(async () => ({ mtimeMs: 1, written: true })),
        },
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
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
          create: vi.fn(async () => ({
            created: {
              bare: false,
              branch: "feature/new-worktree",
              detached: false,
              head: "cab123",
              isCurrent: false,
              isMain: false,
              locked: false,
              lockedReason: null,
              path: "/Users/xyz/ABC/pier.worktree/new-worktree",
              prunable: false,
              prunableReason: null,
            },
            targetPath: "/Users/xyz/ABC/pier.worktree/new-worktree",
            worktrees: [],
          })),
          creationDefaults: vi.fn(async () => ({
            copyPatterns: [],
            rootPath: "/Users/xyz/ABC/pier.worktree",
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
          openTerminal: vi.fn(async () => null),
          prune: vi.fn(async () => ({
            currentPath: "/Users/xyz/ABC/pier",
            mainPath: "/Users/xyz/ABC/pier",
            path: "/Users/xyz/ABC/pier",
            status: "available",
            worktrees: [],
          })),
          remove: vi.fn(async () => ({
            removedPath: "/Users/xyz/ABC/pier-feature",
            worktrees: [],
          })),
        },
        environments: {
          snapshot: vi.fn(async () => ({
            projects: [],
            version: 1,
            worktreeBindings: [],
          })),
          worktreeBinding: vi.fn(async () => null),
        },
        git: {
          abortMerge: vi.fn(async () => ({ kind: "ok" as const })),
          abortRebase: vi.fn(async () => ({ kind: "ok" as const })),
          checkoutBranch: vi.fn(async () => true),
          commit: vi.fn(async () => true),
          continueRebase: vi.fn(async () => ({
            kind: "ok" as const,
            message: "",
          })),
          createBranch: vi.fn(async () => true),
          deleteBranch: vi.fn(async () => true),
          discardChanges: vi.fn(async () => true),
          getDiffPatch: vi.fn(async () => ({ files: [] })),
          getDiffSummary: vi.fn(async () => ({
            changed: 0,
            deletions: 0,
            files: [],
            insertions: 0,
          })),
          getDiffText: vi.fn(async () => ""),
          listIgnored: vi.fn(async () => []),
          getStatus: vi.fn(async () => ({
            branch: {
              ahead: 0,
              behind: 0,
              branch: "main",
              mergedIntoDefault: null,
              oid: "abc123",
              upstream: null,
              upstreamGone: false,
            },
            counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
            delta: null,
            files: [],
            remoteSync: null,
            repoState: { kind: "clean" as const },
            stashCount: 0,
          })),
          getRepoInfo: vi.fn(async () => ({
            defaultBranch: null,
            gitCommonDir: "/Users/xyz/ABC/pier/.git",
            gitDir: "/Users/xyz/ABC/pier/.git",
            gitRoot: "/Users/xyz/ABC/pier",
            headOid: "abc123",
            isBare: false,
            isWorktree: false,
          })),
          listBranches: vi.fn(async () => []),
          searchBranches: vi.fn(async () => ({
            currentBranch: "main",
            durationMs: 0,
            items: [],
            message: null,
            status: "ok" as const,
          })),
          listStashes: vi.fn(async () => ({
            entries: [],
            kind: "ok" as const,
          })),
          merge: vi.fn(async () => ({ kind: "ok" as const, message: "" })),
          popStash: vi.fn(async () => ({ kind: "ok" as const })),
          applyStash: vi.fn(async () => ({ kind: "ok" as const })),
          dropStash: vi.fn(async () => ({ kind: "ok" as const })),
          rebase: vi.fn(async () => ({ kind: "ok" as const, message: "" })),
          stage: vi.fn(async () => true),
          stash: vi.fn(async () => ({ kind: "ok" as const })),
          unstage: vi.fn(async () => true),
          undoLastCommit: vi.fn(async () => ({ kind: "ok" as const })),
          validateBranchName: vi.fn(async () => true),
          watch: vi.fn(() => () => undefined),
        },
        terminal: {
          applyHostSnapshot: vi.fn(),
        },
        preferences: {
          read: vi.fn(async () => ({})),
        },
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 720,
      height: 696,
      left: 0,
      right: 1280,
      toJSON: () => ({}),
      top: 24,
      width: 1280,
      x: 0,
      y: 24,
    });
  });

  afterEach(async () => {
    act(() => {
      resetAppDialogForTests();
    });
    cleanup();
    dispose?.();
    dispose = null;
    await rendererPluginRuntime.dispose();
    terminalStatusItemRegistry.clearForTests();
    clearPluginPanelsForTests();
    usePanelDescriptorStore.setState({ activeId: null, descriptors: {} });
    useWorkspaceStore.setState({ api: null });
    usePluginOverlayStore.setState({ current: null });
    resetTerminalInputRoutingForTests();
    useKeybindingScope.setState({
      activePanelComponent: null,
      activePanelId: null,
      activePanelKind: null,
      overlayStack: [],
    });
    vi.restoreAllMocks();
  });

  it("启用时注册命令面板动作和终端状态栏项", () => {
    dispose = activateWorktreePlugin();

    expect(actionRegistry.get("pier.worktree.list")).toBeDefined();
    expect(actionRegistry.get("pier.worktree.create")).toBeDefined();
    expect(actionRegistry.get("pier.worktree.delete")).toBeDefined();
    expect(actionRegistry.get("pier.worktree.prune")).toBeDefined();
    expect(actionRegistry.get("pier.git.switchBranch")).toBeDefined();
    expect(actionRegistry.get("pier.git.merge")).toBeDefined();
    expect(actionRegistry.get("pier.git.stash")).toBeDefined();
    expect(actionRegistry.get("pier.git.rebaseContinue")).toBeDefined();
    expect(actionRegistry.get("pier.git.undoLastCommit")).toBeDefined();
    expect(actionRegistry.get("pier.worktree.switch")).toBeUndefined();
    expect(
      terminalStatusItemRegistry
        .list()
        .map((item) => item.id)
        .includes("pier.worktree.status")
    ).toBe(true);
  });

  it("禁用旧 Git Changes 面板和打开变更命令", () => {
    dispose = activateWorktreePlugin();

    expect(getPluginPanelRegistrations().has("pier.git.changes")).toBe(false);
    expect(actionRegistry.get("pier.git.changes.open")).toBeUndefined();
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
    expect(
      actionRegistry.get("pier.worktree.prune")?.metadata?.aliases?.()
    ).toEqual(
      expect.arrayContaining(["locale worktree prune", "本地化清理工作树"])
    );
  });

  it("禁用时不注册任何 renderer 贡献", async () => {
    await rendererPluginRuntime.refresh([pluginEntry(false)]);

    expect(actionRegistry.get("pier.worktree.list")).toBeUndefined();
    expect(actionRegistry.get("pier.worktree.create")).toBeUndefined();
    expect(actionRegistry.get("pier.worktree.delete")).toBeUndefined();
    expect(terminalStatusItemRegistry.list()).toEqual([]);
  });

  it("Create、Delete 和 Prune 入口在 Git 上下文可用", () => {
    dispose = activateWorktreePlugin();

    expect(actionRegistry.get("pier.worktree.create")?.enabled?.()).toBe(true);
    expect(actionRegistry.get("pier.worktree.delete")?.enabled?.()).toBe(true);
    expect(actionRegistry.get("pier.worktree.prune")?.enabled?.()).toBe(true);
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
    expect(actionRegistry.get("pier.worktree.delete")?.title()).toBe(
      "删除工作树..."
    );
    expect(actionRegistry.get("pier.worktree.prune")?.title()).toBe(
      "清理工作树"
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
            projectRootPath: "/Users/xyz",
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
    // 标题直接用分支名, "主工作树" 语义只由 badge 表达, 不再重复放 description。
    expect(main).toMatchObject({
      badges: expect.arrayContaining([
        expect.objectContaining({ label: "main" }),
      ]),
      checked: true,
      detail: "/Users/xyz/ABC/pier",
      label: "main",
    });
    expect(main?.description).toBeUndefined();
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

  it("Worktree 打开失败时向用户展示错误提示而不是静默吞掉", async () => {
    vi.mocked(window.pier.worktrees.open).mockRejectedValueOnce(
      new Error("path is not a known worktree for this repository")
    );
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.worktree.list")?.handler();
    const quickPick = useCommandPaletteController.getState().quickPick;
    const linked = quickPick?.sections
      ?.flatMap((section) => section.items)
      .find((item) => item.id === "worktree:/Users/xyz/ABC/pier-feature");
    if (!(quickPick && linked)) {
      throw new Error("expected linked worktree item");
    }

    await quickPick.onAccept(linked);

    expect(
      await screen.findByRole("alertdialog", {
        name: "Worktree operation failed",
      })
    ).toBeTruthy();
    expect(
      screen.getByText("path is not a known worktree for this repository")
    ).toBeTruthy();
  });

  it("Worktree 创建命令打开创建面板 overlay", async () => {
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.worktree.create")?.handler();
    await vi.waitFor(() => {
      expect(usePluginOverlayStore.getState().current).not.toBeNull();
    });

    expect(window.pier.worktrees.list).toHaveBeenCalledWith({
      path: "/Users/xyz/ABC/pier",
    });
    expect(window.pier.worktrees.creationDefaults).toHaveBeenCalledWith({
      path: "/Users/xyz/ABC/pier",
    });
    expect(window.pier.git.listBranches).toHaveBeenCalledWith(
      "/Users/xyz/ABC/pier",
      { kind: "all" }
    );
    expect(usePluginOverlayStore.getState().current).toMatchObject({
      id: "worktree-create",
      pluginId: GIT_PLUGIN_ID,
    });
  });

  it("Worktree 删除和清理命令走插件 worktree API", async () => {
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.worktree.delete")?.handler();
    const deletePick = useCommandPaletteController.getState().quickPick;
    const item = deletePick?.items?.find(
      (candidate) => candidate.id === "delete:/Users/xyz/ABC/pier-feature"
    );
    if (!(deletePick && item)) {
      throw new Error("expected delete worktree quick pick");
    }
    const deletePromise = deletePick.onAccept(item);
    await waitFor(() => {
      expect(
        useCommandPaletteController
          .getState()
          .quickPick?.items?.some((candidate) => candidate.id === "confirm")
      ).toBe(true);
    });
    const confirmDelete = useCommandPaletteController.getState().quickPick;
    const confirmDeleteItem = confirmDelete?.items?.find(
      (candidate) => candidate.id === "confirm"
    );
    if (!(confirmDelete && confirmDeleteItem)) {
      throw new Error("expected delete confirmation");
    }
    await confirmDelete.onAccept(confirmDeleteItem);
    await deletePromise;
    expect(window.pier.worktrees.remove).toHaveBeenCalledWith({
      currentPath: "/Users/xyz/ABC/pier",
      path: "/Users/xyz/ABC/pier-feature",
    });

    const prunePromise = actionRegistry.get("pier.worktree.prune")?.handler();
    await waitFor(() => {
      expect(
        useCommandPaletteController
          .getState()
          .quickPick?.items?.some((candidate) => candidate.id === "confirm")
      ).toBe(true);
    });
    const pruneConfirm = useCommandPaletteController.getState().quickPick;
    const pruneConfirmItem = pruneConfirm?.items?.find(
      (candidate) => candidate.id === "confirm"
    );
    if (!(pruneConfirm && pruneConfirmItem)) {
      throw new Error("expected prune confirmation");
    }
    await pruneConfirm.onAccept(pruneConfirmItem);
    await prunePromise;
    expect(window.pier.worktrees.prune).toHaveBeenCalledWith({
      path: "/Users/xyz/ABC/pier",
    });
  });

  it("Worktree 清理返回 unavailable 时不显示成功提示", async () => {
    vi.mocked(window.pier.worktrees.prune).mockResolvedValueOnce({
      path: "/Users/xyz/ABC/pier",
      reason: "not_git_repo",
      status: "unavailable",
      worktrees: [],
    });
    dispose = activateWorktreePlugin();

    const prunePromise = actionRegistry.get("pier.worktree.prune")?.handler();
    await waitFor(() => {
      expect(
        useCommandPaletteController
          .getState()
          .quickPick?.items?.some((candidate) => candidate.id === "confirm")
      ).toBe(true);
    });
    const pruneConfirm = useCommandPaletteController.getState().quickPick;
    const pruneConfirmItem = pruneConfirm?.items?.find(
      (candidate) => candidate.id === "confirm"
    );
    if (!(pruneConfirm && pruneConfirmItem)) {
      throw new Error("expected prune confirmation");
    }
    await pruneConfirm.onAccept(pruneConfirmItem);
    await prunePromise;

    const message = useCommandPaletteController.getState().quickPick;
    const messageItem = message?.items?.find(
      (candidate) => candidate.id === "worktree-message"
    );
    expect(messageItem?.label).toBe("Worktree operation failed");
    expect(messageItem?.label).not.toBe("Stale worktrees pruned");
  });

  it("Git 合并命令列出分支并合并选中分支", async () => {
    vi.mocked(window.pier.git.searchBranches).mockResolvedValueOnce({
      currentBranch: "main",
      durationMs: 4,
      items: [
        branchOption({
          commit: "def4567890",
          kind: "local",
          name: "feature/git-panel",
          refName: "refs/heads/feature/git-panel",
        }),
      ],
      message: null,
      status: "ok",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.merge")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const item = quickPick?.items?.find(
      (candidate) => candidate.id === "refs/heads/feature/git-panel"
    );
    expect(item).toMatchObject({
      data: expect.objectContaining({
        name: "feature/git-panel",
        refName: "refs/heads/feature/git-panel",
      }),
      label: "feature/git-panel",
      searchTerms: ["feature/git-panel", "refs/heads/feature/git-panel"],
    });
    expect(quickPick?.renderItem).toEqual(expect.any(Function));
    if (!(quickPick && item)) {
      throw new Error("expected merge branch quick pick");
    }

    await quickPick.onAccept(item);

    expect(window.pier.git.merge).toHaveBeenCalledWith(
      "/Users/xyz/ABC/pier",
      "feature/git-panel"
    );
    expect(toastMocks.loading).toHaveBeenCalledWith("Merging...");
    expect(toastMocks.success).toHaveBeenCalledWith(
      "Successfully merged branch feature/git-panel",
      { id: "git-loading-toast" }
    );
  });

  it("Git 切换分支命令只列出本地分支并切换选中分支", async () => {
    vi.mocked(window.pier.git.searchBranches).mockResolvedValueOnce({
      currentBranch: "main",
      durationMs: 4,
      items: [
        branchOption({
          commit: "def4567890",
          current: true,
          kind: "local",
          name: "main",
          refName: "refs/heads/main",
        }),
        branchOption({
          commit: "aaa1111111",
          kind: "remote",
          name: "origin/feature/remote",
          refName: "refs/remotes/origin/feature/remote",
        }),
        branchOption({
          commit: "bbb2222222",
          kind: "local",
          name: "feature/local",
          refName: "refs/heads/feature/local",
        }),
      ],
      message: null,
      status: "ok",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.switchBranch")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    expect(quickPick).toMatchObject({
      placeholder: "Select a branch to switch to",
      title: "Git: Switch Branch...",
    });
    expect(quickPick?.items?.map((item) => item.id)).toEqual([
      "refs/heads/feature/local",
    ]);
    const item = quickPick?.items?.find(
      (candidate) => candidate.id === "refs/heads/feature/local"
    );
    if (!(quickPick && item)) {
      throw new Error("expected switch branch quick pick");
    }

    await quickPick.onAccept(item);

    expect(window.pier.git.checkoutBranch).toHaveBeenCalledWith(
      "/Users/xyz/ABC/pier",
      "feature/local"
    );
    expect(toastMocks.loading).toHaveBeenCalledWith("Switching branch...");
    expect(toastMocks.success).toHaveBeenCalledWith(
      "Switched to branch feature/local",
      { id: "git-loading-toast" }
    );
  });

  it("Git 分支选择请求全量候选、不截断 50 条并展示加载提示", async () => {
    vi.mocked(window.pier.git.searchBranches).mockResolvedValueOnce({
      currentBranch: "main",
      durationMs: 4,
      items: Array.from({ length: 60 }, (_item, index) =>
        branchOption({
          commit: `c${index}`,
          kind: "local",
          name: `feature/${index}`,
          refName: `refs/heads/feature/${index}`,
        })
      ),
      message: null,
      status: "ok",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.merge")?.handler();

    expect(window.pier.git.searchBranches).toHaveBeenCalledWith(
      "/Users/xyz/ABC/pier",
      { diffMode: "mergeIntoCurrent", limit: 1000, query: "" }
    );
    expect(toastMocks.loading).toHaveBeenCalledWith("Loading branches...");
    expect(toastMocks.dismiss).toHaveBeenCalledWith("git-loading-toast");
    const quickPick = useCommandPaletteController.getState().quickPick;
    expect(quickPick?.items).toHaveLength(60);
  });

  it("Git 分支搜索为空时只展示 info toast，不把结果信息写回命令面板", async () => {
    vi.mocked(window.pier.git.searchBranches).mockResolvedValueOnce({
      currentBranch: "main",
      durationMs: 4,
      items: [],
      message: null,
      status: "ok",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.merge")?.handler();

    expect(toastMocks.info).toHaveBeenCalledWith(
      "No other branches found",
      undefined
    );
    expect(useCommandPaletteController.getState().quickPick).toBeNull();
    expect(window.pier.git.merge).not.toHaveBeenCalled();
  });

  it("Git 分支选择使用 LoomDesk searchBranches 结果和完整 ref id", async () => {
    vi.mocked(window.pier.git.searchBranches).mockResolvedValueOnce({
      currentBranch: "topic/current",
      durationMs: 5,
      items: [
        branchOption({
          aheadFromCurrent: 3,
          authorName: "Main Author",
          behindFromCurrent: 5,
          commit: "ccc3333333",
          committerDate: "2026-01-01T00:00:00Z",
          kind: "local",
          name: "main",
          pinReason: "default",
          refName: "refs/heads/main",
          subject: "main subject",
          tipTreeInCurrentHistory: {
            commit: "eb9c60a2",
            commitsSince: 6,
            subject: "squash merge commit",
          },
        }),
        branchOption({
          commit: "bbb2222222",
          kind: "local",
          name: "feature/local",
          refName: "refs/heads/feature/local",
        }),
        branchOption({
          authorName: "Remote Author",
          commit: "aaa1111111",
          kind: "remote",
          name: "origin/feature/newer",
          refName: "refs/remotes/origin/feature/newer",
          subject: "remote subject",
        }),
      ],
      message: null,
      status: "ok",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.merge")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    expect(quickPick?.items?.map((item) => item.id)).toEqual([
      "refs/heads/main",
      "refs/heads/feature/local",
      "refs/remotes/origin/feature/newer",
    ]);
    expect(quickPick?.items?.[0]).toMatchObject({
      data: expect.objectContaining({
        name: "main",
        refName: "refs/heads/main",
      }),
      searchTerms: ["main", "refs/heads/main"],
    });
    expect(quickPick?.items?.[2]).toMatchObject({
      data: expect.objectContaining({
        name: "origin/feature/newer",
        refName: "refs/remotes/origin/feature/newer",
      }),
      searchTerms: [
        "origin/feature/newer",
        "refs/remotes/origin/feature/newer",
      ],
    });
    const firstBranch = quickPick?.items?.[0];
    if (!(quickPick?.renderItem && firstBranch)) {
      throw new Error("expected branch row renderer");
    }
    const branchRow = render(<div>{quickPick.renderItem(firstBranch)}</div>);
    expect(branchRow.getByText("main")).toBeVisible();
    expect(branchRow.getByText("default")).toBeVisible();
    expect(branchRow.getByText("graph")).toBeVisible();
    expect(branchRow.getByText("3↑")).toBeVisible();
    expect(branchRow.getByText("5↓")).toBeVisible();
    expect(branchRow.getByText("seen in history")).toBeVisible();
    expect(
      branchRow.container.querySelector("[data-branch-picker-row-ahead-behind]")
        ?.textContent
    ).toBe("graph5↓3↑");
    expect(
      branchRow.container.querySelector("[data-branch-picker-row-ahead-behind]")
    ).toHaveAttribute(
      "title",
      "Commit graph counts only. Squash or rebase merges may show already-applied commits as branch-only."
    );
    expect(
      branchRow.container.querySelector(
        "[data-branch-picker-row-tip-tree-in-history]"
      )
    ).toHaveAttribute(
      "title",
      "Branch tip tree matches eb9c60a2 in the current history; current branch has 6 newer commit(s)."
    );
    // ahead/behind 用主题语义 token,badge 用 shadcn Badge,不硬编码调色板色
    expect(branchRow.getByText("3↑")).toHaveClass("text-success");
    expect(branchRow.getByText("5↓")).toHaveClass("text-warning");
    expect(branchRow.getByText("default")).toHaveAttribute(
      "data-slot",
      "badge"
    );
    expect(branchRow.getByText("seen in history")).toHaveAttribute(
      "data-slot",
      "badge"
    );
    expect(branchRow.getByText("Main Author")).toBeVisible();
    expect(branchRow.getByText("ccc3333333")).toBeVisible();
    expect(branchRow.getByText("· main subject")).toBeVisible();
    const remoteBranch = quickPick.items?.[2];
    if (!remoteBranch) {
      throw new Error("expected remote branch row");
    }
    const remoteRow = render(<div>{quickPick.renderItem(remoteBranch)}</div>);
    expect(remoteRow.getByText("remote")).toBeVisible();
    expect(remoteRow.getByText("remote")).toHaveAttribute("data-slot", "badge");
    expect(remoteRow.getByText("Remote Author")).toBeVisible();
    expect(remoteRow.getByText("aaa1111111")).toBeVisible();
    expect(remoteRow.getByText("· remote subject")).toBeVisible();
    expect(window.pier.git.searchBranches).toHaveBeenCalledWith(
      "/Users/xyz/ABC/pier",
      { diffMode: "mergeIntoCurrent", limit: 1000, query: "" }
    );
  });

  it("Git 合并冲突后显示详情且不打开已禁用的 Review 面板", async () => {
    const addPanel = vi.fn();
    useWorkspaceStore.setState({
      api: {
        addPanel,
        panels: [],
      },
    } as never);
    vi.mocked(window.pier.git.searchBranches).mockResolvedValueOnce({
      currentBranch: "main",
      durationMs: 4,
      items: [
        branchOption({
          commit: "def4567890",
          kind: "local",
          name: "feature/conflict",
          refName: "refs/heads/feature/conflict",
        }),
      ],
      message: null,
      status: "ok",
    });
    vi.mocked(window.pier.git.merge).mockResolvedValueOnce({
      conflictCount: 2,
      kind: "conflict",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.merge")?.handler();
    const branchPick = useCommandPaletteController.getState().quickPick;
    const branchItem = branchPick?.items?.find(
      (candidate) => candidate.id === "refs/heads/feature/conflict"
    );
    if (!(branchPick && branchItem)) {
      throw new Error("expected merge branch quick pick");
    }

    const acceptPromise = branchPick.onAccept(branchItem);
    expect(await screen.findByText("Merge Conflicts")).toBeVisible();
    expect(
      screen.getByText(
        "Merge resulted in 2 conflict(s) that need to be resolved."
      )
    ).toBeVisible();
    expect(screen.getByRole("alertdialog")).toHaveAttribute(
      "data-size",
      "default"
    );
    expect(useCommandPaletteController.getState().quickPick?.title).not.toBe(
      "Merge Conflicts"
    );
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await acceptPromise;

    expect(toastMocks.dismiss).toHaveBeenCalledWith("git-loading-toast");
    expect(addPanel).not.toHaveBeenCalled();
    expect(
      usePanelDescriptorStore.getState().descriptors["pier.git.changes"]
    ).toBeUndefined();
  });

  it("Git 弹出暂存命令列出 stash 并 pop 选中项", async () => {
    vi.mocked(window.pier.git.listStashes).mockResolvedValueOnce({
      entries: [
        {
          date: "2026-01-01T00:00:00.000Z",
          hash: "abc123",
          index: 0,
          message: "WIP on main",
        },
      ],
      kind: "ok",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.stashPop")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const item = quickPick?.items?.find((candidate) => candidate.id === "0");
    if (!(quickPick && item)) {
      throw new Error("expected stash quick pick");
    }
    await quickPick.onAccept(item);

    expect(window.pier.git.popStash).toHaveBeenCalledWith(
      "/Users/xyz/ABC/pier",
      0
    );
  });

  it("Git 弹出暂存遇到冲突后显示详情且不打开已禁用的 Review 面板", async () => {
    const addPanel = vi.fn();
    useWorkspaceStore.setState({
      api: {
        addPanel,
        panels: [],
      },
    } as never);
    vi.mocked(window.pier.git.listStashes).mockResolvedValueOnce({
      entries: [
        {
          date: "2026-01-01T00:00:00.000Z",
          hash: "abc123",
          index: 0,
          message: "WIP on main",
        },
      ],
      kind: "ok",
    });
    vi.mocked(window.pier.git.popStash).mockResolvedValueOnce({
      kind: "conflict",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.stashPop")?.handler();

    const stashPick = useCommandPaletteController.getState().quickPick;
    const stashItem = stashPick?.items?.find(
      (candidate) => candidate.id === "0"
    );
    if (!(stashPick && stashItem)) {
      throw new Error("expected stash quick pick");
    }
    const acceptPromise = stashPick.onAccept(stashItem);
    expect(await screen.findByText("Stash Conflicts")).toBeVisible();
    expect(
      screen.getByText(
        "Stash was applied but resulted in conflicts that need to be resolved."
      )
    ).toBeVisible();
    expect(useCommandPaletteController.getState().quickPick?.title).not.toBe(
      "Stash Conflicts"
    );
    expect(screen.getByRole("alertdialog")).toHaveAttribute(
      "data-size",
      "default"
    );
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await acceptPromise;

    expect(toastMocks.dismiss).toHaveBeenCalledWith("git-loading-toast");
    expect(addPanel).not.toHaveBeenCalled();
    expect(
      usePanelDescriptorStore.getState().descriptors["pier.git.changes"]
    ).toBeUndefined();
  });

  it("Git 暂存列表 unavailable 时展示 LoomDesk 风格失败信息", async () => {
    vi.mocked(window.pier.git.listStashes).mockResolvedValueOnce({
      kind: "unavailable",
      message: "fatal: not a git repository",
    });
    dispose = activateWorktreePlugin();

    const handlerPromise = actionRegistry.get("pier.git.stashPop")?.handler();

    expect(await screen.findByText("Git operation failed")).toBeVisible();
    expect(screen.getByText("fatal: not a git repository")).toBeVisible();
    expect(getLastTerminalHostSnapshot()).toEqual(
      expect.objectContaining({
        webOverlayRects: expect.arrayContaining([
          expect.objectContaining({ id: "app-dialog" }),
        ]),
        webRequestCount: 1,
      })
    );
    expect(useKeybindingScope.getState().overlayStack).toContain(
      "overlay:app-dialog"
    );
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await handlerPromise;
    await waitFor(() => {
      expect(getLastTerminalHostSnapshot()).toEqual(
        expect.objectContaining({
          webOverlayRects: [],
          webRequestCount: 0,
        })
      );
    });
    expect(useKeybindingScope.getState().overlayStack).not.toContain(
      "overlay:app-dialog"
    );
    expect(useCommandPaletteController.getState().quickPick).toBeNull();
    expect(window.pier.git.popStash).not.toHaveBeenCalled();
  });

  it("Git 暂存命令按 VS Code 语义只暂存已跟踪(includeUntracked: false)", async () => {
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.stash")?.handler();

    expect(window.pier.git.stash).toHaveBeenCalledWith("/Users/xyz/ABC/pier", {
      includeUntracked: false,
    });
    expect(toastMocks.success).toHaveBeenCalledWith("Changes stashed", {
      id: "git-loading-toast",
    });
  });

  it("Git 含未跟踪暂存命令传 includeUntracked: true", async () => {
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.stashIncludeUntracked")?.handler();

    expect(window.pier.git.stash).toHaveBeenCalledWith("/Users/xyz/ABC/pier", {
      includeUntracked: true,
    });
  });

  it("Git 应用暂存命令 apply 选中项且不走 pop", async () => {
    vi.mocked(window.pier.git.listStashes).mockResolvedValueOnce({
      entries: [
        {
          date: "2026-01-01T00:00:00.000Z",
          hash: "abc123",
          index: 1,
          message: "WIP on main",
        },
      ],
      kind: "ok",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.stashApply")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const item = quickPick?.items?.find((candidate) => candidate.id === "1");
    if (!(quickPick && item)) {
      throw new Error("expected stash quick pick");
    }
    await quickPick.onAccept(item);

    expect(window.pier.git.applyStash).toHaveBeenCalledWith(
      "/Users/xyz/ABC/pier",
      1
    );
    expect(window.pier.git.popStash).not.toHaveBeenCalled();
    expect(toastMocks.success).toHaveBeenCalledWith(
      "Stash applied (kept in stash list)",
      { id: "git-loading-toast" }
    );
  });

  it("Git 应用暂存遇到冲突后显示详情且不打开已禁用的 Review 面板", async () => {
    const addPanel = vi.fn();
    useWorkspaceStore.setState({
      api: {
        addPanel,
        panels: [],
      },
    } as never);
    vi.mocked(window.pier.git.listStashes).mockResolvedValueOnce({
      entries: [
        {
          date: "2026-01-01T00:00:00.000Z",
          hash: "abc123",
          index: 1,
          message: "WIP on main",
        },
      ],
      kind: "ok",
    });
    vi.mocked(window.pier.git.applyStash).mockResolvedValueOnce({
      kind: "conflict",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.stashApply")?.handler();
    const stashPick = useCommandPaletteController.getState().quickPick;
    const stashItem = stashPick?.items?.find(
      (candidate) => candidate.id === "1"
    );
    if (!(stashPick && stashItem)) {
      throw new Error("expected stash quick pick");
    }

    const acceptPromise = stashPick.onAccept(stashItem);
    expect(await screen.findByText("Stash Conflicts")).toBeVisible();
    expect(
      screen.getByText(
        "Stash was applied but resulted in conflicts that need to be resolved."
      )
    ).toBeVisible();
    expect(screen.getByRole("alertdialog")).toHaveAttribute(
      "data-size",
      "default"
    );
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await acceptPromise;

    expect(window.pier.git.applyStash).toHaveBeenCalledWith(
      "/Users/xyz/ABC/pier",
      1
    );
    expect(window.pier.git.popStash).not.toHaveBeenCalled();
    expect(addPanel).not.toHaveBeenCalled();
    expect(
      usePanelDescriptorStore.getState().descriptors["pier.git.changes"]
    ).toBeUndefined();
  });

  it("Git 删除暂存需确认弹窗通过后才调用 dropStash", async () => {
    vi.mocked(window.pier.git.listStashes).mockResolvedValueOnce({
      entries: [
        {
          date: "2026-01-01T00:00:00.000Z",
          hash: "abc123",
          index: 2,
          message: "WIP on main",
        },
      ],
      kind: "ok",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.stashDrop")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const item = quickPick?.items?.find((candidate) => candidate.id === "2");
    if (!(quickPick && item)) {
      throw new Error("expected stash quick pick");
    }
    const acceptPromise = quickPick.onAccept(item);

    expect(await screen.findByText("Git: Drop Stash...")).toBeVisible();
    expect(screen.getByRole("alertdialog")).toHaveAttribute("data-size", "sm");
    // {{stash}} 插值链路：fallback 也必须替换为实际 label
    expect(await screen.findByText(DROP_STASH_CONFIRM_BODY_RE)).toBeVisible();
    expect(screen.getByRole("button", { name: "Drop" })).toHaveAttribute(
      "data-variant",
      "destructive"
    );
    // 确认前不得触发删除
    expect(window.pier.git.dropStash).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    await acceptPromise;

    expect(window.pier.git.dropStash).toHaveBeenCalledWith(
      "/Users/xyz/ABC/pier",
      2
    );
    expect(toastMocks.success).toHaveBeenCalledWith("Stash dropped", {
      id: "git-loading-toast",
    });
  });

  it("Git 删除暂存取消确认则不调用 dropStash", async () => {
    vi.mocked(window.pier.git.listStashes).mockResolvedValueOnce({
      entries: [
        {
          date: "2026-01-01T00:00:00.000Z",
          hash: "abc123",
          index: 0,
          message: "WIP on main",
        },
      ],
      kind: "ok",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.stashDrop")?.handler();

    const quickPick = useCommandPaletteController.getState().quickPick;
    const item = quickPick?.items?.find((candidate) => candidate.id === "0");
    if (!(quickPick && item)) {
      throw new Error("expected stash quick pick");
    }
    const acceptPromise = quickPick.onAccept(item);

    expect(await screen.findByText("Git: Drop Stash...")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await acceptPromise;

    expect(window.pier.git.dropStash).not.toHaveBeenCalled();
    expect(toastMocks.loading).not.toHaveBeenCalled();
  });

  it("Git 撤销提交使用 shadcn 确认弹窗并显示 loading 结果", async () => {
    dispose = activateWorktreePlugin();

    const handlerPromise = actionRegistry
      .get("pier.git.undoLastCommit")
      ?.handler();

    expect(await screen.findByText("Git: Undo Last Commit")).toBeVisible();
    expect(screen.getByRole("alertdialog")).toHaveAttribute("data-size", "sm");
    expect(
      screen.getByText(
        "Undo the last commit? Changes will be preserved as staged."
      )
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveAttribute(
      "data-variant",
      "destructive"
    );
    expect(useCommandPaletteController.getState().quickPick).toBeNull();
    expect(getLastTerminalHostSnapshot()).toEqual(
      expect.objectContaining({
        webOverlayRects: expect.arrayContaining([
          expect.objectContaining({ id: "app-dialog" }),
        ]),
        webRequestCount: 1,
      })
    );
    expect(useKeybindingScope.getState().overlayStack).toContain(
      "overlay:app-dialog"
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await handlerPromise;
    await waitFor(() => {
      expect(getLastTerminalHostSnapshot()).toEqual(
        expect.objectContaining({
          webOverlayRects: [],
          webRequestCount: 0,
        })
      );
    });
    expect(useKeybindingScope.getState().overlayStack).not.toContain(
      "overlay:app-dialog"
    );

    expect(window.pier.git.undoLastCommit).toHaveBeenCalledWith(
      "/Users/xyz/ABC/pier"
    );
    expect(toastMocks.loading).toHaveBeenCalledWith("Undoing commit...");
    expect(toastMocks.success).toHaveBeenCalledWith(
      "Last commit undone (changes preserved as staged)",
      { id: "git-loading-toast" }
    );
  });

  it("Git 继续变基仍有冲突时显示详情且不打开已禁用的 Review 面板", async () => {
    const addPanel = vi.fn();
    useWorkspaceStore.setState({
      api: {
        addPanel,
        panels: [],
      },
    } as never);
    vi.mocked(window.pier.git.continueRebase).mockResolvedValueOnce({
      kind: "conflict",
      message: "CONFLICT (content): still unresolved",
    });
    dispose = activateWorktreePlugin();

    const handlerPromise = actionRegistry
      .get("pier.git.rebaseContinue")
      ?.handler();

    expect(await screen.findByText("Rebase Conflicts")).toBeVisible();
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Rebase still has conflicts. Resolve them, then continue."
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "CONFLICT (content): still unresolved"
    );
    expect(screen.getByRole("alertdialog")).toHaveAttribute(
      "data-size",
      "default"
    );
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await handlerPromise;

    expect(window.pier.git.continueRebase).toHaveBeenCalledWith(
      "/Users/xyz/ABC/pier"
    );
    expect(addPanel).not.toHaveBeenCalled();
    expect(
      usePanelDescriptorStore.getState().descriptors["pier.git.changes"]
    ).toBeUndefined();
  });

  it("Git 变基冲突后显示详情且不打开已禁用的 Review 面板", async () => {
    const addPanel = vi.fn();
    useWorkspaceStore.setState({
      api: {
        addPanel,
        panels: [],
      },
    } as never);
    vi.mocked(window.pier.git.searchBranches).mockResolvedValueOnce({
      currentBranch: "main",
      durationMs: 4,
      items: [
        branchOption({
          commit: "def4567890",
          kind: "local",
          name: "feature/rebase",
          refName: "refs/heads/feature/rebase",
        }),
      ],
      message: null,
      status: "ok",
    });
    vi.mocked(window.pier.git.rebase).mockResolvedValueOnce({
      kind: "conflict",
      message: "CONFLICT (content): Merge conflict",
    });
    dispose = activateWorktreePlugin();

    await actionRegistry.get("pier.git.rebase")?.handler();
    const branchPick = useCommandPaletteController.getState().quickPick;
    const branchItem = branchPick?.items?.find(
      (candidate) => candidate.id === "refs/heads/feature/rebase"
    );
    if (!(branchPick && branchItem)) {
      throw new Error("expected rebase branch quick pick");
    }

    const acceptPromise = branchPick.onAccept(branchItem);
    expect(await screen.findByText("Rebase Conflicts")).toBeVisible();
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Rebase paused due to conflicts. Resolve them, then continue."
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "CONFLICT (content): Merge conflict"
    );
    expect(useCommandPaletteController.getState().quickPick?.title).not.toBe(
      "Rebase Conflicts"
    );
    expect(screen.getByRole("alertdialog")).toHaveAttribute(
      "data-size",
      "default"
    );
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await acceptPromise;

    expect(toastMocks.dismiss).toHaveBeenCalledWith("git-loading-toast");
    expect(addPanel).not.toHaveBeenCalled();
    expect(
      usePanelDescriptorStore.getState().descriptors["pier.git.changes"]
    ).toBeUndefined();
  });

  it("终端状态栏下拉面板使用自身 panel context 打开 worktree 列表", async () => {
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
          projectRootPath: "/Users/xyz/ABC/pier-feature",
          worktreeRoot: "/Users/xyz/ABC/pier-feature",
        },
        cwd: "/Users/xyz/ABC/pier-feature/src",
        panelId: "terminal-feature",
        title: null,
      })
    );

    fireEvent.pointerDown(screen.getByTestId("worktree-status-trigger"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Switch Worktree" })
    );

    await waitFor(() => {
      expect(window.pier.worktrees.check).toHaveBeenCalledWith({
        path: "/Users/xyz/ABC/pier-feature",
      });
    });
  });

  it("upstream 已 gone 时展示带文字的红色胶囊", async () => {
    vi.mocked(window.pier.git.getStatus).mockResolvedValue({
      branch: {
        ahead: 0,
        behind: 0,
        branch: "feature/gone-branch",
        oid: "abc123",
        upstream: "origin/feature/gone-branch",
        upstreamGone: true,
        mergedIntoDefault: null,
      },
      counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
      delta: null,
      files: [],
      remoteSync: null,
      repoState: { kind: "clean" as const },
      stashCount: 0,
    });
    dispose = activateWorktreePlugin();
    const statusItem = terminalStatusItemRegistry
      .list()
      .find((item) => item.id === "pier.worktree.status");
    if (!statusItem) {
      throw new Error("expected worktree status item");
    }

    render(
      statusItem.render({
        context: { ...context, branch: "feature/gone-branch" },
        cwd: context.cwd ?? null,
        panelId: "terminal-1",
        title: null,
      })
    );

    const pill = await screen.findByTestId("upstream-gone-pill");
    expect(pill).toHaveTextContent("upstream gone");
  });

  it("no upstream 状态展示带文字胶囊且不会复用未跟踪图标", async () => {
    vi.mocked(window.pier.git.getStatus).mockResolvedValue({
      branch: {
        ahead: 0,
        behind: 0,
        branch: "feature/no-upstream",
        mergedIntoDefault: null,
        oid: "abc123",
        upstream: null,
        upstreamGone: false,
      },
      counts: { conflict: 0, modified: 0, staged: 0, untracked: 1 },
      delta: null,
      files: [],
      remoteSync: null,
      repoState: { kind: "clean" as const },
      stashCount: 0,
    });
    dispose = activateWorktreePlugin();
    const statusItem = terminalStatusItemRegistry
      .list()
      .find((item) => item.id === "pier.worktree.status");
    if (!statusItem) {
      throw new Error("expected worktree status item");
    }

    render(
      statusItem.render({
        context: { ...context, branch: "feature/no-upstream" },
        cwd: context.cwd ?? null,
        panelId: "terminal-1",
        title: null,
      })
    );

    const pill = await screen.findByTestId("no-upstream-pill");
    expect(within(pill).getByText("no upstream")).toBeVisible();

    const trigger = screen.getByTestId("worktree-status-trigger");
    expect(
      trigger.querySelectorAll('[data-git-icon="git-branch-plus"]')
    ).toHaveLength(1);

    const dirtyIndicator = screen.getByTestId("git-dirty-indicator");
    const untrackedIcons = dirtyIndicator.querySelectorAll(
      '[data-git-icon="git-branch-plus"]'
    );
    expect(untrackedIcons).toHaveLength(1);
    expect(trigger.querySelector('[data-git-icon="git-branch-plus"]')).toBe(
      untrackedIcons[0]
    );
  });
  it("分支已合入默认分支时展示 merged 胶囊，可与 gone 胶囊共存", async () => {
    vi.mocked(window.pier.git.getStatus).mockResolvedValue({
      branch: {
        ahead: 0,
        behind: 0,
        branch: "feature/done",
        mergedIntoDefault: true,
        oid: "abc123",
        upstream: "origin/feature/done",
        upstreamGone: true,
      },
      counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
      delta: null,
      files: [],
      remoteSync: null,
      repoState: { kind: "clean" as const },
      stashCount: 0,
    });
    dispose = activateWorktreePlugin();
    const statusItem = terminalStatusItemRegistry
      .list()
      .find((item) => item.id === "pier.worktree.status");
    if (!statusItem) {
      throw new Error("expected worktree status item");
    }

    render(
      statusItem.render({
        context: { ...context, branch: "feature/done" },
        cwd: context.cwd ?? null,
        panelId: "terminal-1",
        title: null,
      })
    );

    const merged = await screen.findByTestId("merged-pill");
    expect(merged).toHaveTextContent("merged");
    expect(
      merged.querySelector('[data-git-icon="git-merge"]')
    ).toBeInTheDocument();
    expect(screen.getByTestId("upstream-gone-pill")).toBeInTheDocument();
  });

  it("工作区状态计数使用 Git 图标族", async () => {
    vi.mocked(window.pier.git.getStatus).mockResolvedValue({
      branch: {
        ahead: 0,
        behind: 0,
        branch: "feature/dirty",
        mergedIntoDefault: false,
        oid: "abc123",
        upstream: "origin/feature/dirty",
        upstreamGone: false,
      },
      counts: { conflict: 4, modified: 2, staged: 1, untracked: 3 },
      delta: null,
      files: [],
      remoteSync: null,
      repoState: { kind: "clean" as const },
      stashCount: 0,
    });
    dispose = activateWorktreePlugin();
    const statusItem = terminalStatusItemRegistry
      .list()
      .find((item) => item.id === "pier.worktree.status");
    if (!statusItem) {
      throw new Error("expected worktree status item");
    }

    render(
      statusItem.render({
        context: { ...context, branch: "feature/dirty" },
        cwd: context.cwd ?? null,
        panelId: "terminal-1",
        title: null,
      })
    );

    const dirtyIndicator = await screen.findByTestId("git-dirty-indicator");
    expect(
      dirtyIndicator.querySelector('[data-git-icon="git-commit-horizontal"]')
    ).toBeInTheDocument();
    expect(
      dirtyIndicator.querySelector('[data-git-icon="git-compare-arrows"]')
    ).toBeInTheDocument();
    expect(
      dirtyIndicator.querySelector('[data-git-icon="git-branch-plus"]')
    ).toBeInTheDocument();
    expect(
      dirtyIndicator.querySelector('[data-git-icon="git-merge-conflict"]')
    ).toBeInTheDocument();
  });

  it("同步和 stash 计数使用 Git 图标族", async () => {
    vi.mocked(window.pier.git.getStatus).mockResolvedValue({
      branch: {
        ahead: 2,
        behind: 1,
        branch: "feature/sync",
        mergedIntoDefault: false,
        oid: "abc123",
        upstream: "origin/feature/sync",
        upstreamGone: false,
      },
      counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
      delta: null,
      files: [],
      remoteSync: null,
      repoState: { kind: "clean" as const },
      stashCount: 3,
    });
    dispose = activateWorktreePlugin();
    const statusItem = terminalStatusItemRegistry
      .list()
      .find((item) => item.id === "pier.worktree.status");
    if (!statusItem) {
      throw new Error("expected worktree status item");
    }

    render(
      statusItem.render({
        context: { ...context, branch: "feature/sync" },
        cwd: context.cwd ?? null,
        panelId: "terminal-1",
        title: null,
      })
    );

    const trigger = await screen.findByTestId("worktree-status-trigger");
    expect(
      trigger.querySelectorAll('[data-git-icon="git-pull-request-arrow"]')
    ).toHaveLength(2);
    expect(
      trigger.querySelector('[data-git-icon="git-commit-horizontal"]')
    ).toBeInTheDocument();
  });

  it("DETACHED 胶囊使用 text-foreground（neutral 风格），与 muted 计数区分", async () => {
    vi.mocked(window.pier.git.getStatus).mockResolvedValue({
      branch: {
        ahead: 0,
        behind: 0,
        branch: null,
        mergedIntoDefault: null,
        oid: "abc1234def",
        upstream: null,
        upstreamGone: false,
      },
      counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
      delta: null,
      files: [],
      remoteSync: null,
      repoState: { kind: "clean" as const },
      stashCount: 0,
    });
    dispose = activateWorktreePlugin();
    const statusItem = terminalStatusItemRegistry
      .list()
      .find((item) => item.id === "pier.worktree.status");
    if (!statusItem) {
      throw new Error("expected worktree status item");
    }

    const { branch: _omitted, ...contextWithoutBranch } = context;
    render(
      statusItem.render({
        context: contextWithoutBranch,
        cwd: context.cwd ?? null,
        panelId: "terminal-1",
        title: null,
      })
    );

    const pill = await screen.findByText("DETACHED");
    expect(pill.className).toContain("text-foreground");
  });

  it("分支名不设固定宽度上限，仅靠 truncate 在溢出时截断", async () => {
    const longBranch =
      "Ysheep666/GIT-能力增强-一个足够长的分支名不该在空间够用时被截断";
    vi.mocked(window.pier.git.getStatus).mockResolvedValue({
      branch: {
        ahead: 0,
        behind: 0,
        branch: longBranch,
        oid: "abc123",
        upstream: null,
        upstreamGone: false,
        mergedIntoDefault: null,
      },
      counts: { conflict: 0, modified: 0, staged: 0, untracked: 0 },
      delta: null,
      files: [],
      remoteSync: null,
      repoState: { kind: "clean" as const },
      stashCount: 0,
    });
    dispose = activateWorktreePlugin();
    const statusItem = terminalStatusItemRegistry
      .list()
      .find((item) => item.id === "pier.worktree.status");
    if (!statusItem) {
      throw new Error("expected worktree status item");
    }

    render(
      statusItem.render({
        context: { ...context, branch: longBranch },
        cwd: context.cwd ?? null,
        panelId: "terminal-1",
        title: null,
      })
    );

    const label = await screen.findByText(longBranch);
    expect(label.className).toContain("truncate");
    expect(label.className).not.toMatch(FIXED_MAX_WIDTH_CLASS_RE);
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
          projectRootPath: "/Users/xyz",
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
    await rendererPluginRuntime.refresh([pluginEntry(true)]);
    expect(actionRegistry.get("pier.worktree.list")).toBeDefined();

    await rendererPluginRuntime.refresh([pluginEntry(true)]);
    expect(actionRegistry.get("pier.worktree.list")).toBeDefined();

    await rendererPluginRuntime.refresh([pluginEntry(false)]);
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
    await rendererPluginRuntime.refresh([localEntry]);

    expect(actionRegistry.get("pier.worktree.list")).toBeUndefined();
    expect(terminalStatusItemRegistry.list()).toEqual([]);
  });

  it("renderer builtin catalog owns the git plugin module", () => {
    expect(
      BUILTIN_RENDERER_PLUGIN_MODULES.map((plugin) => plugin.id)
    ).toContain(GIT_PLUGIN_ID);
    expect(gitRendererPlugin.id).toBe(GIT_PLUGIN_ID);
  });

  it("renderer builtin catalog registers the Files file-panel with integrated tree and renders root entries", async () => {
    const filesModule = BUILTIN_RENDERER_PLUGIN_MODULES.find(
      (plugin) => plugin.id === FILES_PLUGIN_ID
    );
    expect(filesModule).toBeDefined();
    if (!filesModule) {
      throw new Error(
        "expected Files renderer plugin module in builtin catalog"
      );
    }
    const projectRoot =
      context.projectRootPath ??
      context.worktreeRoot ??
      context.gitRoot ??
      context.cwd ??
      "/Users/xyz/ABC/pier";
    const list = vi.fn<RendererPluginContext["files"]["list"]>(() =>
      Promise.resolve([
        {
          kind: "directory" as const,
          name: "src",
          path: "src",
          root: projectRoot,
        },
        {
          kind: "file" as const,
          name: "package.json",
          path: "package.json",
          root: projectRoot,
        },
      ])
    );
    const baseFilesContext = createRendererPluginContext(
      filesPluginEntry(true)
    );
    const filesContext: RendererPluginContext = {
      ...baseFilesContext,
      files: { ...baseFilesContext.files, list },
    };
    const disposeFiles = filesModule.activate(filesContext);
    try {
      const registration =
        getPluginPanelRegistrations().get(FILES_FILE_PANEL_ID);
      expect(registration).toMatchObject({
        id: FILES_FILE_PANEL_ID,
        kind: "web",
      });
      const FilesPanel = registration?.component;
      if (!FilesPanel) {
        throw new Error("expected Files file-panel registration");
      }

      const { container } = render(
        <FilesPanel {...makeFilesPanelProps({ context })} />
      );

      await waitFor(() => {
        expect(list).toHaveBeenCalledWith("/Users/xyz/ABC/pier", { path: "" });
      });
      const treeElement = getPierFileTree(container);
      expect(treeElement).toBeVisible();
      const filesTreeHost = container.querySelector(
        'file-tree-container[aria-label="Files"]'
      );
      expect(filesTreeHost).toBeInstanceOf(HTMLElement);
      // bridge wrapper 承接布局尺寸(flex-1),shadow host 自身撑满 wrapper。
      const treeBridge = container.querySelector(
        '[data-slot="pier-file-tree-bridge"]'
      );
      expect(treeBridge).toBeInstanceOf(HTMLElement);
      expect(treeBridge).toHaveClass("min-h-0", "flex-1", "w-full");
      expect(filesTreeHost).toHaveClass("h-full", "min-h-0", "w-full");
      expect(
        (filesTreeHost as HTMLElement).shadowRoot?.querySelector(
          '[data-file-tree-virtualized-scroll="true"]'
        )
      ).toBeInstanceOf(HTMLElement);
      expect(filesTreeHost).not.toHaveClass("overflow-auto");
      const tree = within(treeElement);
      expect(tree.getByRole("treeitem", { name: "src" })).toBeVisible();
      expect(
        tree.getByRole("treeitem", { name: "package.json" })
      ).toBeVisible();
    } finally {
      disposeFiles();
    }
  });

  it("Files file-panel tree lazily loads expanded directory children from the host files API", async () => {
    const projectRoot =
      context.projectRootPath ??
      context.worktreeRoot ??
      context.gitRoot ??
      context.cwd ??
      "/Users/xyz/ABC/pier";
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      (_root, options) => {
        if (options?.path === "") {
          return Promise.resolve([
            {
              kind: "directory",
              path: "src",
              root: projectRoot,
            },
          ]);
        }
        if (options?.path === "src") {
          return Promise.resolve([
            {
              kind: "file",
              path: "src/App.tsx",
              root: projectRoot,
            },
          ]);
        }
        return Promise.reject(
          new Error(`unexpected list path ${options?.path ?? "<missing>"}`)
        );
      }
    );
    const { container, disposeFiles } = renderFilesFilePanel(list);

    try {
      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(projectRoot, { path: "" });
      });
      const tree = within(getPierFileTree(container));
      const srcRow = tree.getByRole("treeitem", { name: "src" });

      fireEvent.click(srcRow);

      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(projectRoot, { path: "src" });
      });
      expect(
        await tree.findByRole("treeitem", { name: APP_TSX_TREEITEM_PATTERN })
      ).toBeVisible();
    } finally {
      disposeFiles();
    }
  });

  it("Files file-panel tree lazily loads second-level directory children after a first-level expand", async () => {
    const projectRoot =
      context.projectRootPath ??
      context.worktreeRoot ??
      context.gitRoot ??
      context.cwd ??
      "/Users/xyz/ABC/pier";
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      (_root, options) => {
        if (options?.path === "") {
          return Promise.resolve([
            { kind: "directory", path: "src", root: projectRoot },
          ]);
        }
        if (options?.path === "src") {
          return Promise.resolve([
            { kind: "directory", path: "src/nested", root: projectRoot },
            { kind: "file", path: "src/index.ts", root: projectRoot },
          ]);
        }
        if (options?.path === "src/nested") {
          return Promise.resolve([
            { kind: "file", path: "src/nested/deep-a.ts", root: projectRoot },
            { kind: "file", path: "src/nested/deep-b.ts", root: projectRoot },
          ]);
        }
        return Promise.reject(
          new Error(`unexpected list path ${options?.path ?? "<missing>"}`)
        );
      }
    );
    const { container, disposeFiles } = renderFilesFilePanel(list);

    try {
      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(projectRoot, { path: "" });
      });
      const tree = within(getPierFileTree(container));

      fireEvent.click(tree.getByRole("treeitem", { name: "src" }));
      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(projectRoot, { path: "src" });
      });
      const nestedRow = await tree.findByRole("treeitem", {
        name: NESTED_TREEITEM_PATTERN,
      });

      fireEvent.click(nestedRow);
      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(projectRoot, {
          path: "src/nested",
        });
      });
      expect(
        await tree.findByRole("treeitem", { name: DEEP_A_TS_TREEITEM_PATTERN })
      ).toBeVisible();
      expect(
        await tree.findByRole("treeitem", { name: DEEP_B_TS_TREEITEM_PATTERN })
      ).toBeVisible();
    } finally {
      disposeFiles();
    }
  });

  it("Files file-panel tree renders an explicit empty state for an empty project root", async () => {
    const projectRoot =
      context.projectRootPath ??
      context.worktreeRoot ??
      context.gitRoot ??
      context.cwd ??
      "/Users/xyz/ABC/pier";
    const list = vi.fn<RendererPluginContext["files"]["list"]>(() =>
      Promise.resolve([])
    );
    const { disposeFiles } = renderFilesFilePanel(list);

    try {
      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(projectRoot, { path: "" });
      });
      expect(await screen.findByText("No files found")).toBeVisible();
    } finally {
      disposeFiles();
    }
  });

  it("Files file-panel tree shows a directory-scoped error when lazy child loading fails", async () => {
    const projectRoot =
      context.projectRootPath ??
      context.worktreeRoot ??
      context.gitRoot ??
      context.cwd ??
      "/Users/xyz/ABC/pier";
    const list = vi.fn<RendererPluginContext["files"]["list"]>(
      (_root, options) => {
        if (options?.path === "") {
          return Promise.resolve([
            {
              kind: "directory",
              path: "src",
              root: projectRoot,
            },
          ]);
        }
        return Promise.reject(new Error("Permission denied loading src"));
      }
    );
    const { container, disposeFiles } = renderFilesFilePanel(list);

    try {
      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(projectRoot, { path: "" });
      });
      const treeElement = getPierFileTree(container);
      const tree = within(treeElement);
      const srcRow = tree.getByRole("treeitem", { name: "src" });

      fireEvent.click(srcRow);

      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(projectRoot, { path: "src" });
      });
      expect(
        await within(srcRow).findByText(SRC_PERMISSION_LOAD_ERROR_PATTERN)
      ).toBeVisible();
    } finally {
      disposeFiles();
    }
  });

  it("worktree renderer 插件只通过 plugin host API 访问宿主能力", async () => {
    const files = [
      "src/plugins/builtin/git/renderer/worktree-list-action.ts",
      "src/plugins/builtin/git/renderer/worktree-operation-actions.ts",
      "src/plugins/builtin/git/renderer/git-actions.ts",
      "src/plugins/builtin/git/renderer/git-branch-actions.ts",
      "src/plugins/builtin/git/renderer/git-command-helpers.ts",
      "src/plugins/builtin/git/renderer/git-sequencer-actions.ts",
      "src/plugins/builtin/git/renderer/git-stash-actions.ts",
      "src/plugins/builtin/git/renderer/git-status-item.tsx",
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
