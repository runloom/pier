import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { GIT_PLUGIN_LOCALES } from "@plugins/builtin/git/locales/index.ts";
import { GIT_PLUGIN_ID } from "@plugins/builtin/git/manifest.ts";
import {
  openWorktreeCreateOverlay,
  type WorktreeCreateOverlayData,
} from "@plugins/builtin/git/renderer/worktree-create-overlay.tsx";
import type {
  AiGenerateTextRequest,
  AiGenerateTextResult,
  AiStatusResult,
} from "@shared/contracts/ai.ts";
import type { GitBranchRef } from "@shared/contracts/git.ts";
import type {
  WorktreeCreateRequest,
  WorktreeCreateResult,
  WorktreeCreationDefaults,
  WorktreeItem,
  WorktreeOpenTerminalRequest,
  WorktreeOpenTerminalResult,
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
const CONFIRM_LABEL = "Create";
const CANCEL_LABEL = "Cancel";
const CUSTOM_TAB = "Manual naming";
const AI_TAB = "Smart generation";
const START_TASK_LABEL = "Start task now";
const AGENT_LABEL = "Agent";

const ZH_AI_TAB = "智能生成";
const EN_GENERATING_LABEL = "Generating…";
const ZH_TASK_LABEL = "任务描述";
const ZH_CONFIRM_LABEL = "创建";
const ZH_GENERATING_LABEL = "智能生成中…";

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
      path: `/repo.worktree/${name}`,
    }),
    targetPath: `/repo.worktree/${name}`,
    worktrees: [],
  };
}

function overlayData(
  overrides: Partial<WorktreeCreateOverlayData> = {}
): WorktreeCreateOverlayData {
  const defaults: WorktreeCreationDefaults = {
    copyPatterns: [".env*"],
    setupCommand: "pnpm setup:worktree",
    rootPath: "/repo.worktree",
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
function deferTextGeneration(): {
  promise: Promise<AiGenerateTextResult>;
  resolve: (value: AiGenerateTextResult) => void;
} {
  let resolve!: (value: AiGenerateTextResult) => void;
  const promise = new Promise<AiGenerateTextResult>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const createMock =
  vi.fn<(request: WorktreeCreateRequest) => Promise<WorktreeCreateResult>>();
const openTerminalMock =
  vi.fn<
    (
      request: WorktreeOpenTerminalRequest
    ) => Promise<WorktreeOpenTerminalResult>
  >();
const aiStatusMock = vi.fn<() => Promise<AiStatusResult>>();
const generateTextMock =
  vi.fn<(request: AiGenerateTextRequest) => Promise<AiGenerateTextResult>>();
const agentSelectionMock =
  vi.fn<RendererPluginContext["agents"]["selection"]>();
const notificationsSuccessMock = vi.fn();
const notificationsErrorMock = vi.fn();
const tMock = vi.fn(
  (
    _key: string,
    values: Record<string, number | string> | undefined,
    fallback: string | undefined
  ) => interpolate(fallback, values)
);

type GitPluginLocale = keyof typeof GIT_PLUGIN_LOCALES;

function createLocalizedContext(
  locale: GitPluginLocale
): RendererPluginContext {
  const localized = createMockContext();
  localized.i18n.language = () => locale;
  localized.i18n.t = (
    key: string,
    values: Record<string, number | string> | undefined,
    fallback: string | undefined
  ) => {
    const message = (
      GIT_PLUGIN_LOCALES[locale].messages as Record<string, string>
    )[key];
    return interpolate(message ?? fallback, values);
  };
  return localized;
}

function createMockContext(): RendererPluginContext {
  return {
    accounts: {
      add: unimplemented("accounts.add"),
      adoptCurrent: unimplemented("accounts.adoptCurrent"),
      cancelLogin: unimplemented("accounts.cancelLogin"),
      onDidChange: unimplemented("accounts.onDidChange"),
      refreshUsage: unimplemented("accounts.refreshUsage"),
      remove: unimplemented("accounts.remove"),
      select: unimplemented("accounts.select"),
      snapshot: unimplemented("accounts.snapshot"),
    },
    actions: { register: unimplemented("actions.register") },
    agents: {
      selection: agentSelectionMock,
    },
    ai: {
      generateText: generateTextMock,
      status: aiStatusMock,
    },
    commandPalette: {
      openQuickPick: unimplemented("commandPalette.openQuickPick"),
    },
    configuration: {
      get: <T,>() => "" as T,
      onDidChange: unimplemented("configuration.onDidChange"),
      reset: unimplemented("configuration.reset"),
      set: unimplemented("configuration.set"),
    },
    dashboardWidgets: { register: vi.fn(() => vi.fn()) },
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
      applyStash: unimplemented("git.applyStash"),
      dropStash: unimplemented("git.dropStash"),
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
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      disconnect(): void {
        return;
      }
      observe(): void {
        return;
      }
      unobserve(): void {
        return;
      }
    };
  }
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
    createMock.mockResolvedValue(createResultFor("fix-focus", "fix-focus"));
    openTerminalMock.mockResolvedValue({ panelId: "worktree-terminal" });
    agentSelectionMock.mockResolvedValue({
      detectedIds: ["claude", "codex"],
      enabledIds: ["claude", "codex"],
      selectedId: "claude",
    });
    aiStatusMock.mockResolvedValue({
      agent: "claude",
      configured: true,
      label: "Claude",
    });
    generateTextMock.mockResolvedValue({ status: "ok", text: "fix-focus\n" });
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

  it("zh-CN locale labels the AI naming tab as 智能生成", async () => {
    context = createLocalizedContext("zh-CN");

    await openOverlay(context);

    expect(screen.getByRole("tab", { name: ZH_AI_TAB })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "AI 命名" })
    ).not.toBeInTheDocument();
  });

  it("en locale labels the AI mode tab as Smart generation", async () => {
    context = createLocalizedContext("en");

    await openOverlay(context);

    expect(screen.getByRole("tab", { name: AI_TAB })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "AI naming" })
    ).not.toBeInTheDocument();
  });

  it("en locale shows Generating… while branch generation is pending", async () => {
    context = createLocalizedContext("en");
    const generation = deferTextGeneration();
    generateTextMock.mockReturnValueOnce(generation.promise);

    await openOverlay(context);

    fireEvent.change(screen.getByRole("textbox", { name: TASK_LABEL }), {
      target: { value: "fix terminal focus" },
    });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(
      await screen.findByRole("button", { name: EN_GENERATING_LABEL })
    ).toBeInTheDocument();

    await act(async () => {
      generation.resolve({ status: "ok", text: "fix-focus\n" });
      await generation.promise;
    });
    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        branch: "fix-focus",
        name: "fix-focus",
        path: "/repo",
      });
    });
  });

  it("zh-CN locale shows 智能生成中… while branch generation is pending", async () => {
    context = createLocalizedContext("zh-CN");
    const generation = deferTextGeneration();
    generateTextMock.mockReturnValueOnce(generation.promise);

    await openOverlay(context);

    fireEvent.change(screen.getByRole("textbox", { name: ZH_TASK_LABEL }), {
      target: { value: "修复终端焦点问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: ZH_CONFIRM_LABEL }));

    expect(
      await screen.findByRole("button", { name: ZH_GENERATING_LABEL })
    ).toBeInTheDocument();

    await act(async () => {
      generation.resolve({ status: "ok", text: "fix-focus\n" });
      await generation.promise;
    });
    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        branch: "fix-focus",
        name: "fix-focus",
        path: "/repo",
      });
    });
  });

  it("默认 AI 模式打开时自动聚焦任务描述输入框", async () => {
    await openOverlay(context);

    expect(screen.getByRole("textbox", { name: TASK_LABEL })).toHaveFocus();
  });

  it("切到自定义模式后自动聚焦分支输入框", async () => {
    await openOverlay(context);

    clickTab(CUSTOM_TAB);

    expect(
      await screen.findByRole("textbox", { name: BRANCH_LABEL })
    ).toHaveFocus();
  });

  it("默认 AI 模式:提交先调 generateText,创建并打开终端后关闭 overlay,且不弹成功通知", async () => {
    await openOverlay(context);

    const task = screen.getByRole("textbox", { name: TASK_LABEL });
    await act(() => {
      fireEvent.change(task, { target: { value: "修复终端焦点问题" } });
      fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    });

    await vi.waitFor(() => {
      expect(generateTextMock).toHaveBeenCalledWith({
        projectRootPath: "/repo",
        prompt: expect.stringContaining("修复终端焦点问题"),
      });
    });
    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        branch: "fix-focus",
        name: "fix-focus",
        path: "/repo",
      });
    });
    await vi.waitFor(() => {
      expect(openTerminalMock).toHaveBeenCalledWith({
        path: "/repo.worktree/fix-focus",
        runSetup: true,
      });
    });
    expect(
      screen.queryByRole("textbox", { name: TASK_LABEL })
    ).not.toBeInTheDocument();
    expect(notificationsSuccessMock).not.toHaveBeenCalled();
  });

  it("AI 模式:勾选开始任务后在新工作树打开所选 agent 对话", async () => {
    await openOverlay(context);

    fireEvent.click(screen.getByRole("switch", { name: START_TASK_LABEL }));
    fireEvent.click(await screen.findByRole("combobox", { name: AGENT_LABEL }));
    fireEvent.click(await screen.findByRole("option", { name: "Codex" }));

    fireEvent.change(screen.getByRole("textbox", { name: TASK_LABEL }), {
      target: { value: "修复终端焦点问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        branch: "fix-focus",
        name: "fix-focus",
        path: "/repo",
      });
    });
    await vi.waitFor(() => {
      expect(openTerminalMock).toHaveBeenCalledWith({
        agentId: "codex",
        path: "/repo.worktree/fix-focus",
        runSetup: false,
      });
    });
  });

  it("AI 模式:任务描述为空时提交报错且不调 AI", async () => {
    await openOverlay(context);

    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(
      await screen.findByText("Enter a task description")
    ).toBeInTheDocument();
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("AI 生成失败:错误文案渲染、overlay 保留、不创建", async () => {
    generateTextMock.mockResolvedValueOnce({
      message: "boom",
      reason: "request_failed",
      status: "unavailable",
    });
    await openOverlay(context);

    const task = screen.getByRole("textbox", { name: TASK_LABEL });
    fireEvent.change(task, { target: { value: "fix focus" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(
      await screen.findByText("Agent invocation failed: boom")
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

  it("AI 未配置:切回智能生成后点击创建才展示错误", async () => {
    aiStatusMock.mockResolvedValueOnce({
      agent: null,
      configured: false,
      label: "",
    });
    generateTextMock.mockResolvedValueOnce({
      message: "no agent",
      reason: "not_configured",
      status: "unavailable",
    });
    await openOverlay(context);

    expect(
      await screen.findByRole("textbox", { name: BRANCH_LABEL })
    ).toBeInTheDocument();

    clickTab(AI_TAB);
    const task = await screen.findByRole("textbox", { name: TASK_LABEL });
    fireEvent.change(task, { target: { value: "fix focus" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(
      await screen.findByText("Agent invocation failed: no agent")
    ).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
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
      await screen.findByText("/repo.worktree/feature-fix-dialog")
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
        path: "/repo.worktree/fix-dialog",
        runSetup: true,
      });
    });
    expect(generateTextMock).not.toHaveBeenCalled();
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
    generateTextMock.mockResolvedValueOnce({
      message: "boom",
      reason: "request_failed",
      status: "unavailable",
    });
    await openOverlay(context);

    const task = screen.getByRole("textbox", { name: TASK_LABEL });
    fireEvent.change(task, { target: { value: "fix focus" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    await screen.findByText("Agent invocation failed: boom");

    await switchToCustom();
    expect(
      screen.queryByText("Agent invocation failed: boom")
    ).not.toBeInTheDocument();

    clickTab(AI_TAB);
    expect(
      await screen.findByRole("textbox", { name: TASK_LABEL })
    ).toBeInTheDocument();
  });
});
