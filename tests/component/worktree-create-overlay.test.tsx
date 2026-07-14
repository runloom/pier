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
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

const TASK_LABEL = "Task";
const BRANCH_LABEL = "Branch";
const CONFIRM_LABEL = "Create";
const CANCEL_LABEL = "Cancel";
const CUSTOM_TAB = "Manual naming";
const AI_TAB = "Smart generation";
const START_TASK_LABEL = "Start task now";
const AGENT_LABEL = "Agent";

const ZH_AI_TAB = "智能生成";
const ZH_TASK_LABEL = "任务描述";
const ZH_CONFIRM_LABEL = "创建";

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

const createMock = vi.fn<RendererPluginContext["worktrees"]["create"]>();
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
const dialogAlertMock = vi.fn<RendererPluginContext["dialogs"]["alert"]>(
  async () => undefined
);
const loadingDismissMock = vi.fn();
const loadingInfoMock = vi.fn();
const loadingSuccessMock = vi.fn();
const loadingUpdateMock = vi.fn();
const notificationsLoadingMock = vi.fn<
  RendererPluginContext["notifications"]["loading"]
>(() => ({
  dismiss: loadingDismissMock,
  info: loadingInfoMock,
  success: loadingSuccessMock,
  update: loadingUpdateMock,
}));
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
    contextMenu: {
      popup: unimplemented("contextMenu.popup"),
    },
    configuration: {
      get: <T,>() => "" as T,
      onDidChange: unimplemented("configuration.onDidChange"),
      reset: unimplemented("configuration.reset"),
      set: unimplemented("configuration.set"),
    },
    missionControlWidgets: { register: vi.fn(() => vi.fn()) },
    dialogs: {
      alert: dialogAlertMock,
      choice: unimplemented("dialogs.choice"),
      confirm: unimplemented("dialogs.confirm"),
      prompt: unimplemented("dialogs.prompt"),
    },
    environments: {
      projectSnapshot: unimplemented("environments.projectSnapshot"),
      snapshot: unimplemented("environments.snapshot"),
      update: unimplemented("environments.update"),
      worktreeBinding: unimplemented("environments.worktreeBinding"),
    },
    git: {
      abortMerge: unimplemented("git.abortMerge"),
      abortRebase: unimplemented("git.abortRebase"),
      checkoutBranch: unimplemented("git.checkoutBranch"),
      continueRebase: unimplemented("git.continueRebase"),
      discardChanges: unimplemented("git.discardChanges"),
      getDiffPatch: unimplemented("git.getDiffPatch"),
      getFileContent: unimplemented("git.getFileContent"),
      getRepoInfo: unimplemented("git.getRepoInfo"),
      getStatus: unimplemented("git.getStatus"),
      listIgnored: unimplemented("git.listIgnored"),
      listBranches: unimplemented("git.listBranches"),
      listStashes: unimplemented("git.listStashes"),
      merge: unimplemented("git.merge"),
      popStash: unimplemented("git.popStash"),
      pullFastForward: unimplemented("git.pullFastForward"),
      push: unimplemented("git.push"),
      applyStash: unimplemented("git.applyStash"),
      dropStash: unimplemented("git.dropStash"),
      rebase: unimplemented("git.rebase"),
      searchBranches: unimplemented("git.searchBranches"),
      stage: unimplemented("git.stage"),
      stash: unimplemented("git.stash"),
      sync: unimplemented("git.sync"),
      undoLastCommit: unimplemented("git.undoLastCommit"),
      unstage: unimplemented("git.unstage"),
      watch: unimplemented("git.watch"),
    },
    files: {
      confirmDurability: unimplemented("files.confirmDurability"),
      copy: unimplemented("files.copy"),
      drafts: {
        claimLegacy: unimplemented("files.drafts.claimLegacy"),
        delete: unimplemented("files.drafts.delete"),
        get: unimplemented("files.drafts.get"),
        listDiagnostics: unimplemented("files.drafts.listDiagnostics"),
        listKeys: unimplemented("files.drafts.listKeys"),
        set: unimplemented("files.drafts.set"),
      },
      exists: unimplemented("files.exists"),
      inspectPathImpact: unimplemented("files.inspectPathImpact"),
      inspectWriteTarget: unimplemented("files.inspectWriteTarget"),
      list: unimplemented("files.list"),
      mkdir: unimplemented("files.mkdir"),
      move: unimplemented("files.move"),
      pickSaveTarget: unimplemented("files.pickSaveTarget"),
      readDocument: unimplemented("files.readDocument"),
      readText: unimplemented("files.readText"),
      reveal: unimplemented("files.reveal"),
      stat: unimplemented("files.stat"),
      trash: unimplemented("files.trash"),
      watch: unimplemented("files.watch"),
      writeDocument: unimplemented("files.writeDocument"),
      writeText: unimplemented("files.writeText"),
    },
    groupContent: {
      claim: unimplemented("groupContent.claim"),
      release: unimplemented("groupContent.release"),
    },
    i18n: {
      commandDescription: unimplemented("i18n.commandDescription"),
      commandTitle: unimplemented("i18n.commandTitle"),
      language: unimplemented("i18n.language"),
      t: tMock,
    },
    lifecycle: {
      beforeSuspend: vi.fn(() => () => undefined),
    },
    notifications: {
      error: unimplemented("notifications.error"),
      info: unimplemented("notifications.info"),
      loading: notificationsLoadingMock,
      success: unimplemented("notifications.success"),
      system: unimplemented("notifications.system"),
    },
    overlays: {
      close: (id) => closePluginOverlay(GIT_PLUGIN_ID, id),
      open: (overlay) => openPluginOverlay(GIT_PLUGIN_ID, overlay),
    },
    panels: {
      flushLayout: unimplemented("panels.flushLayout"),
      getActiveContext: unimplemented("panels.getActiveContext"),
      getActiveInstanceId: unimplemented("panels.getActiveInstanceId"),
      listInstances: unimplemented("panels.listInstances"),
      updateInstanceParams: unimplemented("panels.updateInstanceParams"),
      open: unimplemented("panels.open"),
      openInstance: unimplemented("panels.openInstance"),
      register: unimplemented("panels.register"),
      registerCloseGuard: unimplemented("panels.registerCloseGuard"),
    },
    terminal: {
      activePanelId: unimplemented("terminal.activePanelId"),
      readSelectionText: unimplemented("terminal.readSelectionText"),
    },
    settings: {
      openSection: (section) =>
        useSettingsDialogStore.getState().openSection(section),
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
  data = overlayData(),
  targetGroupId?: string
): Promise<void> {
  render(<PluginOverlayHost />);
  act(() => {
    openWorktreeCreateOverlay(context, data, targetGroupId);
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

function expectCreateRequest(expected: Partial<WorktreeCreateRequest>): void {
  const call = createMock.mock.calls.at(-1);
  expect(call?.[0]).toEqual(expect.objectContaining(expected));
  expect(call?.[1]).toEqual({ onProgress: expect.any(Function) });
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
      rankedIds: ["claude", "codex"],
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
    useSettingsDialogStore.setState({
      activeSection: "appearance",
      isOpen: false,
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
    useSettingsDialogStore.setState({
      activeSection: "appearance",
      isOpen: false,
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

  it("en locale closes the overlay and shows branch generation in a toast", async () => {
    context = createLocalizedContext("en");
    const generation = deferTextGeneration();
    generateTextMock.mockReturnValueOnce(generation.promise);

    await openOverlay(context);

    const dialog = screen.getByRole("dialog");
    fireEvent.change(screen.getByRole("textbox", { name: TASK_LABEL }), {
      target: { value: "fix terminal focus" },
    });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(notificationsLoadingMock).toHaveBeenCalledWith(
        "Generating branch name…"
      );
    });
    expect(
      screen.queryByRole("textbox", { name: TASK_LABEL })
    ).not.toBeInTheDocument();
    expect(dialog).toHaveAttribute("data-state", "closed");

    await act(async () => {
      generation.resolve({ status: "ok", text: "fix-focus\n" });
      await generation.promise;
    });
    await vi.waitFor(() => {
      expectCreateRequest({
        branch: "fix-focus",
        name: "fix-focus",
        path: "/repo",
      });
    });
    expect(loadingUpdateMock).toHaveBeenCalledWith("Creating worktree…");
  });

  it("zh-CN locale 关闭弹窗并用 toast 展示分支名生成阶段", async () => {
    context = createLocalizedContext("zh-CN");
    const generation = deferTextGeneration();
    generateTextMock.mockReturnValueOnce(generation.promise);

    await openOverlay(context);

    fireEvent.change(screen.getByRole("textbox", { name: ZH_TASK_LABEL }), {
      target: { value: "修复终端焦点问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: ZH_CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(notificationsLoadingMock).toHaveBeenCalledWith("正在生成分支名…");
    });
    expect(
      screen.queryByRole("textbox", { name: ZH_TASK_LABEL })
    ).not.toBeInTheDocument();

    await act(async () => {
      generation.resolve({ status: "ok", text: "fix-focus\n" });
      await generation.promise;
    });
    await vi.waitFor(() => {
      expectCreateRequest({
        branch: "fix-focus",
        name: "fix-focus",
        path: "/repo",
      });
    });
    expect(loadingUpdateMock).toHaveBeenCalledWith("工作树创建中…");
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

  it("默认 AI 模式：创建后在来源标签组打开终端，loading 持续到终端就绪后再 dismiss", async () => {
    await openOverlay(context, overlayData(), "source-group");

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
      expectCreateRequest({
        branch: "fix-focus",
        name: "fix-focus",
        path: "/repo",
      });
    });
    await vi.waitFor(() => {
      expect(openTerminalMock).toHaveBeenCalledWith({
        path: "/repo.worktree/fix-focus",
        targetGroupId: "source-group",
      });
    });
    expect(
      screen.queryByRole("textbox", { name: TASK_LABEL })
    ).not.toBeInTheDocument();
    expect(notificationsLoadingMock).toHaveBeenCalledWith(
      "Generating branch name…"
    );
    expect(loadingUpdateMock).toHaveBeenCalledWith("Creating worktree…");
    expect(loadingUpdateMock).toHaveBeenCalledWith("Opening terminal…");
    expect(loadingDismissMock).toHaveBeenCalledTimes(1);
    expect(loadingSuccessMock).not.toHaveBeenCalled();
    // loading 消息在 openTerminal 完成之后才 dismiss，防止用户看到「loading
    // 消失 → 终端还没打开」的空白窗口期（Bug 1）。
    expect(loadingDismissMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      openTerminalMock.mock.invocationCallOrder[0] ?? 0
    );
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
      expectCreateRequest({
        branch: "fix-focus",
        name: "fix-focus",
        path: "/repo",
        runSetupBeforeReturn: true,
      });
    });
    await vi.waitFor(() => {
      expect(openTerminalMock).toHaveBeenCalledWith({
        agentId: "codex",
        path: "/repo.worktree/fix-focus",
        taskPrompt: "修复终端焦点问题",
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

  it("AI 调用失败:关闭 loading 并用宿主弹窗展示详情", async () => {
    generateTextMock.mockResolvedValueOnce({
      message: "boom",
      reason: "request_failed",
      status: "unavailable",
    });
    await openOverlay(context);

    const task = screen.getByRole("textbox", { name: TASK_LABEL });
    fireEvent.change(task, { target: { value: "fix focus" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(dialogAlertMock).toHaveBeenCalledWith({
        body: "Agent invocation failed: boom",
        title: "Branch name generation failed",
      });
    });
    expect(loadingDismissMock).toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: TASK_LABEL })
    ).not.toBeInTheDocument();
  });

  it("AI 输出不合法时自动修复为语义化分支名", async () => {
    generateTextMock.mockResolvedValueOnce({ status: "ok", text: "！！！\n" });
    await openOverlay(context);

    fireEvent.change(screen.getByRole("textbox", { name: TASK_LABEL }), {
      target: { value: "修复终端焦点问题" },
    });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalled();
    });
    const request = createMock.mock.calls[0]?.[0];
    expect(request?.branch).toBe("fix-focus");
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(dialogAlertMock).not.toHaveBeenCalled();
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

    await vi.waitFor(() => {
      expect(dialogAlertMock).toHaveBeenCalledWith({
        body: "Agent invocation failed: no agent",
        title: "Branch name generation failed",
      });
    });
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
      expectCreateRequest({
        branch: "feature/fix-dialog",
        name: "feature-fix-dialog",
        path: "/repo",
      });
    });
    await vi.waitFor(() => {
      expect(openTerminalMock).toHaveBeenCalledWith({
        path: "/repo.worktree/fix-dialog",
      });
    });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("提交后立即关闭 overlay，同一条 loading toast 跟随真实阶段更新", async () => {
    let resolveCreate!: (result: WorktreeCreateResult) => void;
    const pendingCreate = new Promise<WorktreeCreateResult>((resolve) => {
      resolveCreate = resolve;
    });
    createMock.mockReturnValueOnce(pendingCreate);

    await openOverlay(context);
    await switchToCustom();
    fireEvent.change(screen.getByRole("textbox", { name: BRANCH_LABEL }), {
      target: { value: "feature/background-create" },
    });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledOnce();
    });
    expect(
      screen.queryByRole("textbox", { name: BRANCH_LABEL })
    ).not.toBeInTheDocument();
    expect(notificationsLoadingMock).toHaveBeenCalledWith("Creating worktree…");

    const onProgress = createMock.mock.calls[0]?.[1]?.onProgress;
    onProgress?.({
      operationId: "00000000-0000-4000-8000-000000000001",
      phase: "initializing",
    });
    expect(loadingUpdateMock).toHaveBeenCalledWith("Initializing environment…");
    expect(loadingSuccessMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate(
        createResultFor("background-create", "feature/background-create")
      );
      await pendingCreate;
    });
    await vi.waitFor(() => {
      expect(loadingDismissMock).toHaveBeenCalledTimes(1);
      expect(openTerminalMock).toHaveBeenCalled();
    });
    expect(loadingSuccessMock).not.toHaveBeenCalled();
    // 新契约：loading dismiss 在 openTerminal 完成之后（避免空白窗口期）。
    expect(loadingDismissMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      openTerminalMock.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("does not pass environmentId to worktrees.create", async () => {
    await openOverlay(context);
    await switchToCustom();

    fireEvent.change(screen.getByRole("textbox", { name: BRANCH_LABEL }), {
      target: { value: "feature/no-env" },
    });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalled();
    });
    const request = createMock.mock.calls[0]?.[0];
    expect(request).toBeDefined();
    expect("environmentId" in (request ?? {})).toBe(false);
  });

  it("自定义模式:非法字符与已存在分支被校验拦截", async () => {
    await openOverlay(context);
    await switchToCustom();

    const branch = screen.getByRole("textbox", { name: BRANCH_LABEL });
    fireEvent.change(branch, { target: { value: "bad branch!" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    expect(
      await screen.findByText(
        "Enter a valid Git branch name using letters, digits and . _ / -"
      )
    ).toBeInTheDocument();

    fireEvent.change(branch, { target: { value: "feature/fix..dialog" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    expect(
      await screen.findByText(
        "Enter a valid Git branch name using letters, digits and . _ / -"
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

    fireEvent.click(screen.getByRole("combobox", { name: "Base" }));
    fireEvent.click(await screen.findByRole("option", { name: "develop" }));

    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expectCreateRequest({
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

  it("create 被拒绝:关闭 loading 并用宿主弹窗展示错误详情", async () => {
    createMock.mockRejectedValueOnce(new Error("invalid worktree branch"));
    await openOverlay(context);
    await switchToCustom();

    const branch = screen.getByRole("textbox", { name: BRANCH_LABEL });
    fireEvent.change(branch, { target: { value: "feature/x" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(dialogAlertMock).toHaveBeenCalledWith({
        body: "invalid worktree branch",
        title: "Worktree creation failed",
      });
    });
    expect(loadingDismissMock).toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: BRANCH_LABEL })
    ).not.toBeInTheDocument();
    expect(openTerminalMock).not.toHaveBeenCalled();
  });

  it("创建失败后重新打开 overlay 可以再次提交", async () => {
    createMock.mockRejectedValueOnce(new Error("invalid worktree branch"));
    await openOverlay(context);
    await switchToCustom();

    fireEvent.change(screen.getByRole("textbox", { name: BRANCH_LABEL }), {
      target: { value: "feature/first" },
    });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    await vi.waitFor(() => {
      expect(dialogAlertMock).toHaveBeenCalledWith({
        body: "invalid worktree branch",
        title: "Worktree creation failed",
      });
    });

    act(() => {
      openWorktreeCreateOverlay(context, overlayData());
    });
    await switchToCustom();
    fireEvent.change(screen.getByRole("textbox", { name: BRANCH_LABEL }), {
      target: { value: "feature/second" },
    });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(2);
    });
    expectCreateRequest({
      branch: "feature/second",
      name: "feature-second",
      path: "/repo",
    });
  });

  it("环境初始化失败时明确说明工作树已创建", async () => {
    createMock.mockImplementationOnce(async (_request, options) => {
      options?.onProgress?.({
        operationId: "00000000-0000-4000-8000-000000000001",
        phase: "initializing",
      });
      throw new Error("setup exited with code 1");
    });
    await openOverlay(context);
    await switchToCustom();

    fireEvent.change(screen.getByRole("textbox", { name: BRANCH_LABEL }), {
      target: { value: "feature/setup-fails" },
    });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(dialogAlertMock).toHaveBeenCalledWith({
        body: "setup exited with code 1",
        title: "Worktree created, but environment initialization failed",
      });
    });
    expect(loadingUpdateMock).toHaveBeenCalledWith("Initializing environment…");
    expect(openTerminalMock).not.toHaveBeenCalled();
  });

  it("openTerminal 被拒绝:用宿主弹窗展示错误详情", async () => {
    openTerminalMock.mockRejectedValueOnce(new Error("spawn failed"));
    await openOverlay(context);
    await switchToCustom();

    const branch = screen.getByRole("textbox", { name: BRANCH_LABEL });
    fireEvent.change(branch, { target: { value: "feature/x" } });
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    await vi.waitFor(() => {
      expect(dialogAlertMock).toHaveBeenCalledWith({
        body: "spawn failed",
        title: "Terminal launch failed",
      });
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
});
