import type { AgentHookEvent } from "@shared/contracts/agent-session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentSessionAggregator } from "../../src/main/services/agents/agent-session-aggregator.ts";

function hookEvent(
  event: string,
  panelId = "p1",
  windowId = "1"
): AgentHookEvent {
  return { v: 1, agent: "claude", event, panelId, windowId };
}

describe("AgentSessionAggregator", () => {
  let clock = 0;
  const now = () => clock;

  beforeEach(() => {
    clock = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function advance(ms: number): void {
    clock += ms;
    vi.advanceTimersByTime(ms);
  }

  it("hook 事件建立会话并映射状态（PromptSubmit 立即可见）", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("SessionStart"));
    agg.ingestHookEvent(hookEvent("PromptSubmit"));
    const snap = agg.snapshot();
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0]?.status).toBe("processing");
    expect(snap.sessions[0]?.agentId).toBe("claude");
    expect(snap.sessions[0]?.source).toBe("hook");
    agg.dispose();
  });

  it("未知事件名被忽略", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("WhatIsThis"));
    expect(agg.snapshot().sessions).toHaveLength(0);
    agg.dispose();
  });

  it("stateStartedAt 只在状态变化时重置", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit")); // processing @0
    advance(1000);
    agg.ingestHookEvent(hookEvent("ToolStart")); // tool @1000
    advance(1000);
    agg.ingestHookEvent(hookEvent("ToolComplete")); // 仍 tool
    const s = agg.snapshot().sessions[0];
    expect(s?.status).toBe("tool");
    expect(s?.stateStartedAt).toBe(1000);
    expect(s?.updatedAt).toBe(2000);
    agg.dispose();
  });

  it("回合边界吸收：Stop 之后迟到的 ToolStart 不改状态", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit"));
    agg.ingestHookEvent(hookEvent("Stop")); // 回合结束 → ready
    agg.ingestHookEvent(hookEvent("ToolStart")); // 迟到事件, 应被吸收
    expect(agg.snapshot().sessions[0]?.status).toBe("ready");
    agg.ingestHookEvent(hookEvent("PromptSubmit")); // 新回合重置
    agg.ingestHookEvent(hookEvent("ToolStart"));
    expect(agg.snapshot().sessions[0]?.status).toBe("tool");
    agg.dispose();
  });

  it("subagent 计数：Start +1 / Stop -1, 回合边界清零", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit"));
    agg.ingestHookEvent(hookEvent("SubagentStart"));
    agg.ingestHookEvent(hookEvent("SubagentStart"));
    expect(agg.snapshot().sessions[0]?.subagentCount).toBe(2);
    agg.ingestHookEvent(hookEvent("SubagentStop"));
    expect(agg.snapshot().sessions[0]?.subagentCount).toBe(1);
    agg.ingestHookEvent(hookEvent("Stop"));
    expect(agg.snapshot().sessions[0]?.subagentCount).toBe(0);
    agg.dispose();
  });

  it("panelClosed 删除会话并 5s 冷却孤儿事件", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit"));
    agg.panelClosed("1", "p1");
    expect(agg.snapshot().sessions).toHaveLength(0);
    agg.ingestHookEvent(hookEvent("ToolStart")); // 冷却期内, 丢弃
    expect(agg.snapshot().sessions).toHaveLength(0);
    advance(5001);
    agg.ingestHookEvent(hookEvent("PromptSubmit")); // 冷却过后允许重建
    expect(agg.snapshot().sessions).toHaveLength(1);
    agg.dispose();
  });

  it("跨窗口同名 panelId 互不串扰", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit", "p1", "1"));
    agg.ingestHookEvent(hookEvent("PermissionRequest", "p1", "2"));
    const sessions = agg.snapshot().sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.windowId === "1")?.status).toBe("processing");
    expect(sessions.find((s) => s.windowId === "2")?.status).toBe("waiting");
    agg.panelClosed("1", "p1"); // 只清窗口 1 的
    expect(agg.snapshot().sessions).toHaveLength(1);
    expect(agg.snapshot().sessions[0]?.windowId).toBe("2");
    agg.dispose();
  });

  it("hook 新鲜时抑制标题信号；过期后标题接管", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit")); // hook source
    agg.ingestTitle("1", "p1", "✳ done summarizing"); // 应被抑制
    expect(agg.snapshot().sessions[0]?.status).toBe("processing");
    advance(30 * 60 * 1000 + 1); // 超过 30min TTL
    agg.ingestTitle("1", "p1", "claude working");
    const s = agg.snapshot().sessions[0];
    expect(s?.status).toBe("processing");
    expect(s?.source).toBe("title");
    agg.dispose();
  });

  it("hook 30min 静默后 processing 衰减为 ready", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit"));
    advance(30 * 60 * 1000 + 1);
    expect(agg.snapshot().sessions[0]?.status).toBe("ready");
    agg.dispose();
  });

  it("标题信号不为普通 shell 建会话", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestTitle("1", "p1", "~/dev/pier");
    agg.ingestTitle("1", "p1", "✳ claude idle"); // idle 且无既有 entry
    expect(agg.snapshot().sessions).toHaveLength(0);
    agg.dispose();
  });

  it("title 源 working 3s 无新标题自动归位 ready", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestTitle("1", "p1", "claude working");
    expect(agg.snapshot().sessions[0]?.status).toBe("processing");
    advance(3001);
    expect(agg.snapshot().sessions[0]?.status).toBe("ready");
    agg.dispose();
  });

  it("windowClosed 清空该窗口并保留其他窗口", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit", "p1", "1"));
    agg.ingestHookEvent(hookEvent("PromptSubmit", "p1", "2"));
    expect(agg.snapshot().sessions).toHaveLength(2);

    agg.windowClosed("1");
    const sessions = agg.snapshot().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.windowId).toBe("2");

    // 冷却：窗口 1 的迟到事件在 5s 内被丢弃。
    agg.ingestHookEvent(hookEvent("ToolStart", "p1", "1"));
    expect(agg.snapshot().sessions).toHaveLength(1);
    advance(5001);
    agg.ingestHookEvent(hookEvent("PromptSubmit", "p1", "1"));
    expect(agg.snapshot().sessions).toHaveLength(2);
    agg.dispose();
  });

  it("retainPanels 只清不在集合内的面板", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit", "p1", "1"));
    agg.ingestHookEvent(hookEvent("PromptSubmit", "p2", "1"));
    expect(agg.snapshot().sessions).toHaveLength(2);

    agg.retainPanels("1", ["p1"]);
    const sessions = agg.snapshot().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.panelId).toBe("p1");
    agg.dispose();
  });

  it("SessionEnd 移除会话；迟到 Stop 被短冷却拦截不造幽灵；SessionStart 豁免冷却立即重建", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit"));
    expect(agg.snapshot().sessions).toHaveLength(1);
    agg.ingestHookEvent(hookEvent("SessionEnd"));
    expect(agg.snapshot().sessions).toHaveLength(0);
    agg.ingestHookEvent(hookEvent("Stop")); // 乱序迟到的 curl
    expect(agg.snapshot().sessions).toHaveLength(0);
    // 立即重启 claude：SessionStart 豁免一切冷却, 经 250ms 可见性消抖后出现
    agg.ingestHookEvent(hookEvent("SessionStart"));
    advance(250);
    expect(agg.snapshot().sessions).toHaveLength(1);
    expect(agg.snapshot().sessions[0]?.status).toBe("ready");
    agg.dispose();
  });

  it("迟到的非创建事件不会凭空建会话（幽灵防护）", () => {
    const agg = createAgentSessionAggregator({ now });
    for (const evt of ["Stop", "ToolComplete", "SubagentStop", "error"]) {
      agg.ingestHookEvent(hookEvent(evt));
    }
    expect(agg.snapshot().sessions).toHaveLength(0);
    // 活跃信号可以创建：ToolStart 立即可见
    agg.ingestHookEvent(hookEvent("ToolStart"));
    expect(agg.snapshot().sessions).toHaveLength(1);
    agg.dispose();
  });

  it("SessionStart 创建的会话 250ms 内隐藏（瞬时命令防闪条）", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("SessionStart"));
    expect(agg.snapshot().sessions).toHaveLength(0); // 消抖期隐藏
    advance(250);
    expect(agg.snapshot().sessions).toHaveLength(1);
    agg.dispose();
  });

  it("消抖期内 SessionEnd 到达 → 会话从未可见（claude 秒退场景）", () => {
    const agg = createAgentSessionAggregator({ now });
    const cb = vi.fn();
    agg.onChange(cb);
    agg.ingestHookEvent(hookEvent("SessionStart"));
    agg.ingestHookEvent(hookEvent("SessionEnd"));
    advance(500);
    expect(agg.snapshot().sessions).toHaveLength(0);
    for (const call of cb.mock.calls) {
      expect(call[0].sessions).toHaveLength(0);
    }
    agg.dispose();
  });

  it("Stop 之后的 PermissionRequest 不被回合吸收（真实等待不可吞）", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit"));
    agg.ingestHookEvent(hookEvent("Stop"));
    expect(agg.snapshot().sessions[0]?.status).toBe("ready");
    agg.ingestHookEvent(hookEvent("PermissionRequest"));
    expect(agg.snapshot().sessions[0]?.status).toBe("waiting");
    agg.dispose();
  });

  it("Subagent 事件纯计数不改父状态（防 tool→processing 闪跳）", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit"));
    agg.ingestHookEvent(hookEvent("ToolStart"));
    agg.ingestHookEvent(hookEvent("SubagentStart"));
    const s1 = agg.snapshot().sessions[0];
    expect(s1?.status).toBe("tool");
    expect(s1?.subagentCount).toBe(1);
    agg.ingestHookEvent(hookEvent("SubagentStop"));
    const s2 = agg.snapshot().sessions[0];
    expect(s2?.status).toBe("tool");
    expect(s2?.subagentCount).toBe(0);
    agg.dispose();
  });

  it("标题源 waiting 30min 无更新衰减为 ready（防永久卡死）", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestTitle("1", "p1", "✋ approve tool?");
    expect(agg.snapshot().sessions[0]?.status).toBe("waiting");
    advance(30 * 60 * 1000 + 1);
    expect(agg.snapshot().sessions[0]?.status).toBe("ready");
    agg.dispose();
  });

  it("commandFinished 清理该面板会话并 5s 冷却吸收迟到 hook（崩溃/kill 兜底）", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit"));
    agg.commandFinished("1", "p1");
    expect(agg.snapshot().sessions).toHaveLength(0);
    agg.ingestHookEvent(hookEvent("Stop")); // 迟到 hook, 冷却期内丢弃
    expect(agg.snapshot().sessions).toHaveLength(0);
    agg.ingestHookEvent(hookEvent("SessionStart")); // 豁免冷却, 立即重建
    advance(250);
    expect(agg.snapshot().sessions).toHaveLength(1);
    agg.dispose();
  });

  it("commandFinished 收到悬挂退出码（Ctrl+Z）不清理会话", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestHookEvent(hookEvent("PromptSubmit"));
    // macOS SIGTSTP=18 → 146; 兼容 SIGSTOP/Linux 家族 145-148
    for (const code of [145, 146, 147, 148]) {
      agg.commandFinished("1", "p1", code);
      expect(agg.snapshot().sessions).toHaveLength(1);
    }
    agg.commandFinished("1", "p1", 0); // 真实退出
    expect(agg.snapshot().sessions).toHaveLength(0);
    agg.dispose();
  });

  it("广播 ts 为单调序列（pull/push 同毫秒竞态不可能并列）", () => {
    const agg = createAgentSessionAggregator({ now });
    const t1 = agg.snapshot().ts;
    const t2 = agg.snapshot().ts;
    expect(t2).toBeGreaterThan(t1); // clock 未推进仍严格递增
    agg.dispose();
  });

  it("commandFinished 对无会话面板 no-op（普通 shell 命令不受影响）", () => {
    const agg = createAgentSessionAggregator({ now });
    const cb = vi.fn();
    agg.onChange(cb);
    agg.commandFinished("1", "p1");
    advance(200);
    expect(cb).not.toHaveBeenCalled();
    expect(agg.snapshot().sessions).toHaveLength(0);
    agg.dispose();
  });

  it("commandFinished 同样兜底标题启发式会话（无 hook 的 agent 退出）", () => {
    const agg = createAgentSessionAggregator({ now });
    agg.ingestTitle("1", "p1", "codex working");
    expect(agg.snapshot().sessions).toHaveLength(1);
    agg.commandFinished("1", "p1");
    expect(agg.snapshot().sessions).toHaveLength(0);
    agg.dispose();
  });

  it("onChange 在变更后防抖触发一次", () => {
    const agg = createAgentSessionAggregator({ now });
    const cb = vi.fn();
    agg.onChange(cb);
    agg.ingestHookEvent(hookEvent("PromptSubmit"));
    agg.ingestHookEvent(hookEvent("ToolStart"));
    expect(cb).not.toHaveBeenCalled();
    advance(100);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0].sessions[0]?.status).toBe("tool");
    agg.dispose();
  });
});
