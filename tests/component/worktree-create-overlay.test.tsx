import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  openWorktreeCreateOverlay,
  type WorktreeCreateOverlayData,
} from "@plugins/builtin/git/renderer/worktree-create-overlay.tsx";
import type { GitBranchRef } from "@shared/contracts/git.ts";
import { GIT_PLUGIN_ID } from "@shared/contracts/plugin.ts";
import type {
  WorktreeCreateRequest,
  WorktreeCreateResult,
  WorktreeCreationDefaults,
  WorktreeItem,
  WorktreeOpenTerminalRequest,
} from "@shared/contracts/worktree.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginOverlayHost } from "@/components/common/plugin-overlay-host.tsx";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  closeOverlaysForPlugin,
  closePluginOverlay,
  openPluginOverlay,
} from "@/stores/plugin-overlay.store.ts";

const NEW_WORKTREE_LABEL = "Task or branch";
const BRANCH_LABEL = "Branch";
const CREATE_AND_START_LABEL = "Create and start";
const CREATE_ONLY_LABEL = "Create only";

function interpolate(
  template: string | undefined,
  values: Record<string, number | string> | undefined
): string {
  const base = template ?? "";
  if (!values) {
    return base;
  }
  return base.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

function unimplemented(name: string): () => never {
  return () => {
    throw new Error(`mock context: ${name} should not be called in this test`);
  };
}

function worktreeItem(overrides: Partial<WorktreeItem> = {}): WorktreeItem {
  return {
    bare: false,
    branch: "main",
    detached: false,
    head: "abc123",
    isCurrent: true,
    isMain: true,
    locked: false,
    lockedReason: null,
    path: "/repo",
    prunable: false,
    prunableReason: null,
    ...overrides,
  };
}

function branchRef(overrides: Partial<GitBranchRef> = {}): GitBranchRef {
  return {
    isCurrent: true,
    kind: "local",
    lastCommit: "abc123",
    name: "main",
    upstream: null,
    ...overrides,
  };
}

function defaultCreateResult(): WorktreeCreateResult {
  return {
    copiedFiles: [],
    created: worktreeItem({
      branch: "wt/fix-focus",
      isCurrent: false,
      isMain: false,
      path: "/repo/.worktrees/fix-focus",
    }),
    targetPath: "/repo/.worktrees/fix-focus",
    worktrees: [],
  };
}

function overlayData(
  overrides: Partial<WorktreeCreateOverlayData> = {}
): WorktreeCreateOverlayData {
  const defaults: WorktreeCreationDefaults = {
    branchPrefix: "wt/",
    copyPatterns: [".env*"],
    setupCommand: "pnpm setup:worktree",
  };
  return {
    branches: [branchRef({ name: "main" })],
    defaults,
    existingBranches: ["main"],
    existingNames: [],
    mainPath: "/repo",
    ...overrides,
  };
}

const createMock =
  vi.fn<(request: WorktreeCreateRequest) => Promise<WorktreeCreateResult>>();
const openTerminalMock =
  vi.fn<(request: WorktreeOpenTerminalRequest) => Promise<unknown>>();
const notificationsSuccessMock = vi.fn();
const notificationsErrorMock = vi.fn();
const tMock = vi.fn(
  (
    _key: string,
    values: Record<string, number | string> | undefined,
    fallback: string | undefined
  ) => interpolate(fallback, values)
);

function createMockContext(): RendererPluginContext {
  return {
    actions: { register: unimplemented("actions.register") },
    commandPalette: {
      openQuickPick: unimplemented("commandPalette.openQuickPick"),
    },
    configuration: {
      get: unimplemented("configuration.get"),
      onDidChange: unimplemented("configuration.onDidChange"),
      reset: unimplemented("configuration.reset"),
      set: unimplemented("configuration.set"),
    },
    dialogs: {
      alert: unimplemented("dialogs.alert"),
      confirm: unimplemented("dialogs.confirm"),
    },
    git: {
      abortMerge: unimplemented("git.abortMerge"),
      abortRebase: unimplemented("git.abortRebase"),
      continueRebase: unimplemented("git.continueRebase"),
      discardChanges: unimplemented("git.discardChanges"),
      getDiffPatch: unimplemented("git.getDiffPatch"),
      getFileContent: unimplemented("git.getFileContent"),
      getRepoInfo: unimplemented("git.getRepoInfo"),
      getStatus: unimplemented("git.getStatus"),
      listBranches: unimplemented("git.listBranches"),
      listStashes: unimplemented("git.listStashes"),
      merge: unimplemented("git.merge"),
      popStash: unimplemented("git.popStash"),
      rebase: unimplemented("git.rebase"),
      searchBranches: unimplemented("git.searchBranches"),
      stage: unimplemented("git.stage"),
      stash: unimplemented("git.stash"),
      undoLastCommit: unimplemented("git.undoLastCommit"),
      unstage: unimplemented("git.unstage"),
      watch: unimplemented("git.watch"),
    },
    files: {
      list: unimplemented("files.list"),
      move: unimplemented("files.move"),
      readText: unimplemented("files.readText"),
      rename: unimplemented("files.rename"),
      trash: unimplemented("files.trash"),
      writeText: unimplemented("files.writeText"),
    },
    i18n: {
      commandDescription: unimplemented("i18n.commandDescription"),
      commandTitle: unimplemented("i18n.commandTitle"),
      language: unimplemented("i18n.language"),
      t: tMock,
    },
    notifications: {
      error: notificationsErrorMock,
      info: unimplemented("notifications.info"),
      loading: unimplemented("notifications.loading"),
      success: notificationsSuccessMock,
      system: unimplemented("notifications.system"),
    },
    overlays: {
      close: (id) => closePluginOverlay(GIT_PLUGIN_ID, id),
      open: (overlay) => openPluginOverlay(GIT_PLUGIN_ID, overlay),
    },
    panels: {
      getActiveContext: unimplemented("panels.getActiveContext"),
      open: unimplemented("panels.open"),
      register: unimplemented("panels.register"),
    },
    terminalStatusItems: {
      register: unimplemented("terminalStatusItems.register"),
    },
    worktrees: {
      check: unimplemented("worktrees.check"),
      create: createMock,
      creationDefaults: unimplemented("worktrees.creationDefaults"),
      list: unimplemented("worktrees.list"),
      open: unimplemented("worktrees.open"),
      openTerminal: openTerminalMock,
      prune: unimplemented("worktrees.prune"),
      remove: unimplemented("worktrees.remove"),
    },
  };
}

// jsdom 缺 Radix Select 依赖的几个浏览器 API,组件测试需要本地垫片。
function installSelectPolyfills(): void {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
}

describe("WorktreeCreateOverlay", () => {
  let context: RendererPluginContext;

  beforeEach(() => {
    installSelectPolyfills();
    vi.clearAllMocks();
    createMock.mockResolvedValue(defaultCreateResult());
    openTerminalMock.mockResolvedValue(null);
    context = createMockContext();
    useKeybindingScope.setState({
      activePanelComponent: null,
      activePanelId: null,
      activePanelKind: null,
      overlayStack: [],
    });
  });

  afterEach(() => {
    act(() => {
      closeOverlaysForPlugin(GIT_PLUGIN_ID);
    });
    cleanup();
    useKeybindingScope.setState({
      activePanelComponent: null,
      activePanelId: null,
      activePanelKind: null,
      overlayStack: [],
    });
  });

  it("输入描述后实时推导分支与位置展示", () => {
    render(<PluginOverlayHost />);
    act(() => {
      openWorktreeCreateOverlay(context, overlayData());
    });

    const input = screen.getByRole("textbox", { name: NEW_WORKTREE_LABEL });
    fireEvent.change(input, { target: { value: "fix focus bug" } });

    expect(screen.getByDisplayValue("wt/fix-focus-bug")).toBeInTheDocument();
    expect(screen.getByText(".worktrees/fix-focus-bug")).toBeInTheDocument();
  });

  it("点击 Create and start:create 携带派生 branch/name/path,成功后以 runSetup:true 打开终端", async () => {
    render(<PluginOverlayHost />);
    act(() => {
      openWorktreeCreateOverlay(context, overlayData());
    });

    const input = screen.getByRole("textbox", { name: NEW_WORKTREE_LABEL });
    fireEvent.change(input, { target: { value: "fix focus" } });
    fireEvent.click(
      screen.getByRole("button", { name: CREATE_AND_START_LABEL })
    );

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        branch: "wt/fix-focus",
        name: "fix-focus",
        path: "/repo",
      });
    });
    await vi.waitFor(() => {
      expect(openTerminalMock).toHaveBeenCalledWith({
        path: "/repo/.worktrees/fix-focus",
        runSetup: true,
      });
    });
    expect(notificationsSuccessMock).toHaveBeenCalledWith(
      "wt/fix-focus · /repo/.worktrees/fix-focus"
    );
  });

  it("点击 Create only:create 之后不打开终端", async () => {
    render(<PluginOverlayHost />);
    act(() => {
      openWorktreeCreateOverlay(context, overlayData());
    });

    const input = screen.getByRole("textbox", { name: NEW_WORKTREE_LABEL });
    fireEvent.change(input, { target: { value: "fix focus" } });
    fireEvent.click(screen.getByRole("button", { name: CREATE_ONLY_LABEL }));

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        branch: "wt/fix-focus",
        name: "fix-focus",
        path: "/repo",
      });
    });
    expect(openTerminalMock).not.toHaveBeenCalled();
  });

  it("选中 base 分支后 create 载荷携带 base", async () => {
    render(<PluginOverlayHost />);
    act(() => {
      openWorktreeCreateOverlay(
        context,
        overlayData({
          branches: [
            branchRef({ name: "main" }),
            branchRef({ name: "develop" }),
          ],
        })
      );
    });

    const input = screen.getByRole("textbox", { name: NEW_WORKTREE_LABEL });
    fireEvent.change(input, { target: { value: "fix focus" } });

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "develop" }));

    fireEvent.click(screen.getByRole("button", { name: CREATE_ONLY_LABEL }));

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        base: "develop",
        branch: "wt/fix-focus",
        name: "fix-focus",
        path: "/repo",
      });
    });
  });

  it("create 被拒绝:overlay 保留、错误文案渲染", async () => {
    createMock.mockRejectedValueOnce(new Error("invalid worktree branch"));
    render(<PluginOverlayHost />);
    act(() => {
      openWorktreeCreateOverlay(context, overlayData());
    });

    const input = screen.getByRole("textbox", { name: NEW_WORKTREE_LABEL });
    fireEvent.change(input, { target: { value: "fix focus" } });
    fireEvent.click(
      screen.getByRole("button", { name: CREATE_AND_START_LABEL })
    );

    expect(
      await screen.findByText("invalid worktree branch")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: NEW_WORKTREE_LABEL })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: NEW_WORKTREE_LABEL })
    ).not.toBeDisabled();
    expect(openTerminalMock).not.toHaveBeenCalled();
  });

  it("openTerminal 被拒绝:notifications.error 被调、overlay 已关闭、不抛出", async () => {
    openTerminalMock.mockRejectedValueOnce(new Error("spawn failed"));
    render(<PluginOverlayHost />);
    act(() => {
      openWorktreeCreateOverlay(context, overlayData());
    });

    const input = screen.getByRole("textbox", { name: NEW_WORKTREE_LABEL });
    fireEvent.change(input, { target: { value: "fix focus" } });
    fireEvent.click(
      screen.getByRole("button", { name: CREATE_AND_START_LABEL })
    );

    await vi.waitFor(() => {
      expect(notificationsErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("spawn failed")
      );
    });
    expect(
      screen.queryByRole("textbox", { name: NEW_WORKTREE_LABEL })
    ).not.toBeInTheDocument();
  });

  it("esc 关闭:overlay 卸载", async () => {
    render(<PluginOverlayHost />);
    act(() => {
      openWorktreeCreateOverlay(context, overlayData());
    });

    expect(
      screen.getByRole("textbox", { name: NEW_WORKTREE_LABEL })
    ).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    await vi.waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: NEW_WORKTREE_LABEL })
      ).not.toBeInTheDocument();
    });
  });

  it("creating 态下输入被禁用", async () => {
    let resolveCreate: ((value: WorktreeCreateResult) => void) | undefined;
    createMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve;
      })
    );
    render(<PluginOverlayHost />);
    act(() => {
      openWorktreeCreateOverlay(context, overlayData());
    });

    const input = screen.getByRole("textbox", { name: NEW_WORKTREE_LABEL });
    fireEvent.change(input, { target: { value: "fix focus" } });
    fireEvent.click(
      screen.getByRole("button", { name: CREATE_AND_START_LABEL })
    );

    await vi.waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: NEW_WORKTREE_LABEL })
      ).toBeDisabled();
    });
    expect(screen.getByRole("textbox", { name: BRANCH_LABEL })).toBeDisabled();

    await act(async () => {
      resolveCreate?.(defaultCreateResult());
      await Promise.resolve();
    });
  });
});
