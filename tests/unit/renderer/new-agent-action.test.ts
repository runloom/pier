import type { AgentKind } from "@shared/contracts/agent.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_AGENT_ACTION_CONTRIBUTIONS } from "@/lib/actions/new-agent-action.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastMocks.error } }));

const prepareLaunch = vi.fn();
const detect = vi.fn(async () => ({ detectedIds: [] as AgentKind[] }));
const addTerminal = vi.fn(() => "terminal-1");

function runNewAgent(): Promise<void> | void {
  return NEW_AGENT_ACTION_CONTRIBUTIONS[0]?.handler();
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
  useWorkspaceStore.setState({ addTerminal } as never);
}

describe("new agent action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { agents: { detect, prepareLaunch } },
    });
  });

  afterEach(() => {
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

  it("prepareLaunch 返回 null launchId → 不创建终端", async () => {
    seedStores({
      defaultAgentId: null,
      detectedIds: ["claude"],
      disabledAgentIds: [],
    });
    prepareLaunch.mockResolvedValueOnce({ launchId: null });

    await runNewAgent();

    expect(prepareLaunch).toHaveBeenCalledWith("claude");
    expect(addTerminal).not.toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
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
