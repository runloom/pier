import type { AgentKind } from "@shared/contracts/agent.ts";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  NEW_AGENT_ACTION_CONTRIBUTIONS,
  registerNewAgentAction,
} from "@/lib/actions/new-agent-action.ts";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { ActionInvocation } from "@/lib/actions/types.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import {
  resetAppDialogForTests,
  useAppDialogStore,
} from "@/stores/app-dialog.store.ts";
import { useTerminalPreferencesStore } from "@/stores/terminal-preferences.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastMocks.error } }));

const prepareLaunch = vi.fn();
const detect = vi.fn(async () => ({ detectedIds: [] as AgentKind[] }));
const addTerminal = vi.fn(() => "terminal-1");

function runNewAgent(invocation?: ActionInvocation): Promise<void> | void {
  return NEW_AGENT_ACTION_CONTRIBUTIONS[0]?.handler(invocation);
}

function seedStores(opts: {
  defaultAgentId: AgentKind | "blank" | null;
  detectedIds: AgentKind[];
  disabledAgentIds: AgentKind[];
  hasDetected?: boolean;
}): void {
  useAgentDetectStore.setState({
    detectedIds: opts.detectedIds,
    hasDetected: opts.hasDetected ?? opts.detectedIds.length > 0,
    isDetecting: false,
    isRefreshing: false,
  });
  useAgentPreferencesStore.setState({
    defaultAgentId: opts.defaultAgentId,
    disabledAgentIds: opts.disabledAgentIds,
  });
  useWorkspaceStore.setState({ addTerminal, api: null } as never);
}

describe("new agent action", () => {
  beforeEach(async () => {
    await initI18n();
    await i18next.changeLanguage("en");
    vi.clearAllMocks();
    resetAppDialogForTests();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { agents: { detect, prepareLaunch } },
    });
    useTerminalPreferencesStore.setState({
      terminalNewCwdPolicy: "activeTerminal",
    });
  });

  it("registers one localized default-agent shortcut action", async () => {
    seedStores({
      defaultAgentId: "codex",
      detectedIds: ["claude", "codex"],
      disabledAgentIds: [],
    });
    const dispose = registerNewAgentAction();
    try {
      const actions = actionRegistry
        .list()
        .filter((action) => action.id === "pier.agent.new");

      expect(actions).toHaveLength(1);
      expect(actions[0]?.surfaces).toEqual([]);
      expect(actionRegistry.list("command-palette")).not.toContainEqual(
        actions[0]
      );
      expect(actions[0]?.title()).toBe("Start Default Agent");
      expect(actions[0]?.metadata?.aliases?.()).toEqual(
        expect.arrayContaining(["Codex", "codex"])
      );

      useAgentPreferencesStore.setState({ defaultAgentId: "claude" });
      expect(actions[0]?.metadata?.aliases?.()).toEqual(
        expect.arrayContaining(["Claude", "claude"])
      );
      expect(actions[0]?.metadata?.aliases?.()).not.toContain("codex");

      await i18next.changeLanguage("zh-CN");
      expect(actions[0]?.title()).toBe("启动默认智能体");
    } finally {
      dispose();
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    useAgentDetectStore.setState({
      detectedIds: [],
      hasDetected: false,
      isDetecting: false,
      isRefreshing: false,
    });
    useAgentPreferencesStore.setState({
      defaultAgentId: null,
      disabledAgentIds: [],
    });
    useTerminalPreferencesStore.setState({
      terminalNewCwdPolicy: "activeTerminal",
    });
    resetAppDialogForTests();
    await i18next.changeLanguage("en");
  });

  it("首次调用（detectedIds 为空）→ 先探测再 pickAgent，而非直接 toast", async () => {
    // 模拟未开设置页：detectedIds 为空。ensureDetected → detect 填充 ["claude"]。
    seedStores({
      defaultAgentId: null,
      detectedIds: [],
      disabledAgentIds: [],
    });
    detect.mockResolvedValueOnce({ detectedIds: ["claude"] });
    prepareLaunch.mockResolvedValueOnce({ launchId: "launch-1" });

    await runNewAgent();

    expect(detect).toHaveBeenCalledTimes(1);
    expect(prepareLaunch).toHaveBeenCalledWith("claude");
    expect(addTerminal).toHaveBeenCalledWith({ launchId: "launch-1" });
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("detectedIds 已填充 → 不重复探测（避免每次重跑 which）", async () => {
    seedStores({
      defaultAgentId: null,
      detectedIds: ["claude"],
      disabledAgentIds: [],
    });
    prepareLaunch.mockResolvedValueOnce({ launchId: "launch-2" });

    await runNewAgent();

    expect(detect).not.toHaveBeenCalled();
    expect(prepareLaunch).toHaveBeenCalledWith("claude");
  });

  it("无可用 agent → toast，且不创建终端", async () => {
    // disabled 掉唯一探测到的 agent ⇒ pickAgent 返回 null
    seedStores({
      defaultAgentId: null,
      detectedIds: ["claude"],
      disabledAgentIds: ["claude"],
    });

    await runNewAgent();

    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(prepareLaunch).not.toHaveBeenCalled();
    expect(addTerminal).not.toHaveBeenCalled();
  });

  it("启动探测已完成但结果为空 → 不重复探测，直接 toast", async () => {
    seedStores({
      defaultAgentId: null,
      detectedIds: [],
      disabledAgentIds: [],
      hasDetected: true,
    });

    await runNewAgent();

    expect(detect).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(prepareLaunch).not.toHaveBeenCalled();
    expect(addTerminal).not.toHaveBeenCalled();
  });

  it("探测失败 → 用 AppDialog 展示本地化标题和原始错误", async () => {
    seedStores({
      defaultAgentId: null,
      detectedIds: [],
      disabledAgentIds: [],
    });
    detect.mockRejectedValueOnce(new Error("detect detail"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const pending = runNewAgent();
    await vi.waitFor(() => {
      expect(useAppDialogStore.getState().current).toMatchObject({
        body: "detect detail",
        kind: "alert",
        title: "Couldn’t detect agents",
      });
    });
    expect(prepareLaunch).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();

    resetAppDialogForTests();
    await pending;
  });

  it("启动准备失败 → 用当前语言的 AppDialog 展示原始错误", async () => {
    await i18next.changeLanguage("zh-CN");
    seedStores({
      defaultAgentId: "claude",
      detectedIds: ["claude"],
      disabledAgentIds: [],
    });
    prepareLaunch.mockRejectedValueOnce(new Error("launch detail"));

    const pending = runNewAgent();
    await vi.waitFor(() => {
      expect(useAppDialogStore.getState().current).toMatchObject({
        body: "launch detail",
        kind: "alert",
        title: "无法启动智能体",
      });
    });
    expect(addTerminal).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();

    resetAppDialogForTests();
    await pending;
  });

  it("终端创建失败 → 用当前语言的 AppDialog 展示启动错误", async () => {
    await i18next.changeLanguage("zh-CN");
    seedStores({
      defaultAgentId: "claude",
      detectedIds: ["claude"],
      disabledAgentIds: [],
    });
    prepareLaunch.mockResolvedValueOnce({ launchId: "launch-dock-error" });
    addTerminal.mockImplementationOnce(() => {
      throw new Error("dock boom");
    });

    const pending = runNewAgent();
    await vi.waitFor(() => {
      expect(useAppDialogStore.getState().current).toMatchObject({
        body: "dock boom",
        kind: "alert",
        title: "无法启动智能体",
      });
    });
    expect(addTerminal).toHaveBeenCalledWith({
      launchId: "launch-dock-error",
    });
    expect(toastMocks.error).not.toHaveBeenCalled();

    resetAppDialogForTests();
    await pending;
  });

  it("prepareLaunch 返回 null launchId → 显示失败且不创建终端", async () => {
    seedStores({
      defaultAgentId: null,
      detectedIds: ["claude"],
      disabledAgentIds: [],
    });
    prepareLaunch.mockResolvedValueOnce({ launchId: null });

    await runNewAgent();

    expect(prepareLaunch).toHaveBeenCalledWith("claude");
    expect(addTerminal).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith("Couldn’t start agent");
  });

  it("来源标签组在准备期间关闭 → 显示失败且不回退到其他组", async () => {
    const sourceGroup = { id: "source-group", panels: [] };
    const otherGroup = { id: "other-group", panels: [] };
    seedStores({
      defaultAgentId: "claude",
      detectedIds: ["claude"],
      disabledAgentIds: [],
    });
    useWorkspaceStore.setState({
      addTerminal,
      api: { activeGroup: sourceGroup, groups: [sourceGroup] },
    } as never);
    const launch = Promise.withResolvers<{ launchId: string | null }>();
    prepareLaunch.mockReturnValueOnce(launch.promise);

    const pending = runNewAgent({
      sourcePanelGroupId: "source-group",
    });
    useWorkspaceStore.setState({
      api: { activeGroup: otherGroup, groups: [otherGroup] },
    } as never);
    launch.resolve({ launchId: "launch-orphaned" });
    await pending;

    expect(addTerminal).not.toHaveBeenCalled();
    expect(toastMocks.error).toHaveBeenCalledWith("Couldn’t start agent");
  });

  it("shellDefault 策略不继承来源面板目录", async () => {
    const sourceGroup = { id: "source-group", panels: [] };
    const sourceContext = {
      contextId: "ctx-source",
      cwd: "/repo/source",
      openedPath: "/repo/source",
      projectRootPath: "/repo/source",
      source: "panel" as const,
      updatedAt: 1,
      worktreeKey: "/repo/source",
    };
    seedStores({
      defaultAgentId: "claude",
      detectedIds: ["claude"],
      disabledAgentIds: [],
    });
    useTerminalPreferencesStore.setState({
      terminalNewCwdPolicy: "shellDefault",
    });
    useWorkspaceStore.setState({
      addTerminal,
      api: { activeGroup: sourceGroup, groups: [sourceGroup] },
    } as never);
    prepareLaunch.mockResolvedValueOnce({ launchId: "launch-shell-default" });

    await runNewAgent({
      sourcePanelContext: sourceContext,
      sourcePanelGroupId: "source-group",
      sourcePanelId: "terminal-source",
    });

    expect(addTerminal).toHaveBeenCalledWith({
      launchId: "launch-shell-default",
      referenceGroup: sourceGroup,
    });
  });

  it("成功路径 → 用 launchId 创建终端", async () => {
    seedStores({
      defaultAgentId: "codex",
      detectedIds: ["claude", "codex"],
      disabledAgentIds: [],
    });
    prepareLaunch.mockResolvedValueOnce({ launchId: "launch-xyz" });

    await runNewAgent();

    expect(prepareLaunch).toHaveBeenCalledWith("codex");
    expect(addTerminal).toHaveBeenCalledTimes(1);
    expect(addTerminal).toHaveBeenCalledWith({ launchId: "launch-xyz" });
    expect(toastMocks.error).not.toHaveBeenCalled();
  });
});
