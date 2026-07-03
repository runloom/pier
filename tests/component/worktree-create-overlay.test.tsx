import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  openWorktreeCreateOverlay,
  type WorktreeCreateOverlayData,
} from "@plugins/builtin/git/renderer/worktree-create-overlay.tsx";
import type {
  AiStatusResult,
  AiSuggestBranchRequest,
  AiSuggestBranchResult,
} from "@shared/contracts/ai.ts";
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

const TASK_LABEL = "Task";
const BRANCH_LABEL = "Branch";
const CONFIRM_LABEL = "Confirm";
const CANCEL_LABEL = "Cancel";
const CUSTOM_TAB = "Custom";
const AI_TAB = "AI auto";

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

function createResultFor(name: string, branch: string): WorktreeCreateResult {
  return {
    copiedFiles: [],
    created: worktreeItem({
      branch,
      isCurrent: false,
      isMain: false,
      path: `/repo/.worktrees/${name}`,
    }),
    targetPath: `/repo/.worktrees/${name}`,
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
const aiStatusMock = vi.fn<() => Promise<AiStatusResult>>();
const suggestBranchMock =
  vi.fn<(request: AiSuggestBranchRequest) => Promise<AiSuggestBranchResult>>();
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
    ai: {
      status: aiStatusMock,
      suggestBranch: suggestBranchMock,
    },
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

async function openOverlay(
  context: RendererPluginContext,
  data = overlayData()
): Promise<void> {
  render(<PluginOverlayHost />);
  act(() => {
    openWorktreeCreateOverlay(context, data);
  });
  // 等 ai.status 解析,避免模式自动切换与断言竞争
  await act(async () => {
    await Promise.resolve();
  });
}

function clickTab(name: string): void {
  // Radix Tabs 在 mousedown 时切换选中,click 事件本身不触发
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
}

async function switchToCustom(): Promise<void> {
  clickTab(CUSTOM_TAB);
  await screen.findByRole("textbox", { name: BRANCH_LABEL });
}

describe("WorktreeCreateOverlay", () => {
  let context: RendererPluginContext;

  beforeEach(() => {
    installSelectPolyfills();
    vi.clearAllMocks();
    createMock.mockResolvedValue(createResultFor("fix-focus", "wt/fix-focus"));
    openTerminalMock.mockResolvedValue(null);
    aiStatusMock.mockResolvedValue({
      agent: "claude",
      configured: true,
      label: "Claude",
    });
    suggestBranchMock.mockResolvedValue({ slug: "fix-focus", status: "ok" });
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

  it("默认 AI 模式:提交先调 suggestBranch,再以派生 branch/name 创建并打开终端", async () => {
    await openOverlay(context);

    const task = screen.getByRole("textbox", { name: TASK_LABEL });
    fireEvent.change(task, { target: { value: "修复终端焦点问题" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(suggestBranchMock).toHaveBeenCalledWith({
        text: "修复终端焦点问题",
      });
    });
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

  it("AI 模式:任务描述为空时提交报错且不调 AI", async () => {
    await openOverlay(context);

    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(
      await screen.findByText("Enter a task description")
    ).toBeInTheDocument();
    expect(suggestBranchMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("AI 生成失败:错误文案渲染、overlay 保留、不创建", async () => {
    suggestBranchMock.mockResolvedValueOnce({
      message: "boom",
      reason: "request_failed",
      status: "unavailable",
    });
    await openOverlay(context);

    const task = screen.getByRole("textbox", { name: TASK_LABEL });
    fireEvent.change(task, { target: { value: "fix focus" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(
      await screen.findByText("AI generation failed: boom")
    ).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("textbox", { name: TASK_LABEL })
    ).toBeInTheDocument();
  });

  it("AI 未配置:自动切到自定义模式", async () => {
    aiStatusMock.mockResolvedValueOnce({
      agent: null,
      configured: false,
      label: "",
    });
    await openOverlay(context);

    expect(
      await screen.findByRole("textbox", { name: BRANCH_LABEL })
    ).toBeInTheDocument();
  });

  it("自定义模式:输入分支名实时展示目录预览,提交创建并打开终端", async () => {
    createMock.mockResolvedValue(
      createResultFor("fix-dialog", "feature/fix-dialog")
    );
    await openOverlay(context);
    await switchToCustom();

    const branch = screen.getByRole("textbox", { name: BRANCH_LABEL });
    fireEvent.change(branch, { target: { value: "feature/fix-dialog" } });

    expect(
      await screen.findByText(".worktrees/feature-fix-dialog")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        branch: "feature/fix-dialog",
        name: "feature-fix-dialog",
        path: "/repo",
      });
    });
    await vi.waitFor(() => {
      expect(openTerminalMock).toHaveBeenCalledWith({
        path: "/repo/.worktrees/fix-dialog",
        runSetup: true,
      });
    });
    expect(suggestBranchMock).not.toHaveBeenCalled();
  });

  it("自定义模式:非法字符与已存在分支被校验拦截", async () => {
    await openOverlay(context);
    await switchToCustom();

    const branch = screen.getByRole("textbox", { name: BRANCH_LABEL });
    fireEvent.change(branch, { target: { value: "bad branch!" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    expect(
      await screen.findByText(
        "Branch names may only contain letters, digits and . _ / -"
      )
    ).toBeInTheDocument();

    fireEvent.change(branch, { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    expect(
      await screen.findByText("Branch already exists")
    ).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("选中 base 分支后 create 载荷携带 base", async () => {
    await openOverlay(
      context,
      overlayData({
        branches: [branchRef({ name: "main" }), branchRef({ name: "develop" })],
      })
    );
    await switchToCustom();

    const branch = screen.getByRole("textbox", { name: BRANCH_LABEL });
    fireEvent.change(branch, { target: { value: "feature/x" } });

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "develop" }));

    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        base: "develop",
        branch: "feature/x",
        name: "feature-x",
        path: "/repo",
      });
    });
  });

  it("取消按钮关闭 overlay 且不创建", async () => {
    await openOverlay(context);

    fireEvent.click(screen.getByRole("button", { name: CANCEL_LABEL }));

    await vi.waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: TASK_LABEL })
      ).not.toBeInTheDocument();
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("create 被拒绝:overlay 保留、错误文案渲染", async () => {
    createMock.mockRejectedValueOnce(new Error("invalid worktree branch"));
    await openOverlay(context);
    await switchToCustom();

    const branch = screen.getByRole("textbox", { name: BRANCH_LABEL });
    fireEvent.change(branch, { target: { value: "feature/x" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(
      await screen.findByText("invalid worktree branch")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: BRANCH_LABEL })
    ).not.toBeDisabled();
    expect(openTerminalMock).not.toHaveBeenCalled();
  });

  it("openTerminal 被拒绝:notifications.error 被调、overlay 已关闭、不抛出", async () => {
    openTerminalMock.mockRejectedValueOnce(new Error("spawn failed"));
    await openOverlay(context);
    await switchToCustom();

    const branch = screen.getByRole("textbox", { name: BRANCH_LABEL });
    fireEvent.change(branch, { target: { value: "feature/x" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(notificationsErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("spawn failed")
      );
    });
    expect(
      screen.queryByRole("textbox", { name: BRANCH_LABEL })
    ).not.toBeInTheDocument();
  });

  it("esc 关闭:overlay 卸载", async () => {
    await openOverlay(context);

    expect(
      screen.getByRole("textbox", { name: TASK_LABEL })
    ).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    await vi.waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: TASK_LABEL })
      ).not.toBeInTheDocument();
    });
  });

  it("切换标签会清空上一次的提交错误", async () => {
    suggestBranchMock.mockResolvedValueOnce({
      message: "boom",
      reason: "request_failed",
      status: "unavailable",
    });
    await openOverlay(context);

    const task = screen.getByRole("textbox", { name: TASK_LABEL });
    fireEvent.change(task, { target: { value: "fix focus" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    await screen.findByText("AI generation failed: boom");

    await switchToCustom();
    expect(
      screen.queryByText("AI generation failed: boom")
    ).not.toBeInTheDocument();

    clickTab(AI_TAB);
    expect(
      await screen.findByRole("textbox", { name: TASK_LABEL })
    ).toBeInTheDocument();
  });
});
