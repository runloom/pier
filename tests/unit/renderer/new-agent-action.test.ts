import type { AgentKind } from "@shared/contracts/agent.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_AGENT_ACTION_CONTRIBUTIONS } from "@/lib/actions/new-agent-action.ts";
import { useAgentDetectStore } from "@/stores/agent-detect.store.ts";
import { useAgentPreferencesStore } from "@/stores/agent-preferences.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastMocks.error } }));

const prepareLaunch = vi.fn();
const addTerminal = vi.fn(() => "terminal-1");

function runNewAgent(): Promise<void> | void {
  return NEW_AGENT_ACTION_CONTRIBUTIONS[0]?.handler();
}

function seedStores(opts: {
  defaultAgentId: AgentKind | "blank" | null;
  detectedIds: AgentKind[];
  disabledAgentIds: AgentKind[];
}): void {
  useAgentDetectStore.setState({ detectedIds: opts.detectedIds });
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
      value: { agents: { prepareLaunch } },
    });
  });

  afterEach(() => {
    useAgentDetectStore.setState({ detectedIds: [] });
    useAgentPreferencesStore.setState({
      defaultAgentId: null,
      disabledAgentIds: [],
    });
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
