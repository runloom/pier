import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import type {
  AgentActivity,
  TaskActivity,
} from "@shared/contracts/foreground-activity.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createForegroundActivityAggregator } from "../../../src/main/services/foreground-activity/aggregator.ts";

function hookEvent(
  event: string,
  panelId = "p1",
  windowId = "1"
): AgentHookEventPayload {
  return {
    v: 1,
    kind: "agentEvent",
    agent: "claude",
    event,
    panelId,
    windowId,
  };
}

describe("ForegroundActivityAggregator", () => {
  let clock = 0;
  const now = (): number => clock;

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

  it("agentLaunched → 建立可见 launch-source agent activity, status ready", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    const a = snap.activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.agentId).toBe("codex");
    expect(a.source).toBe("launch");
    expect(a.status).toBe("ready");
    agg.dispose();
  });

  it("ingestAgentEvent(SessionStart) → 建立 hook-source agent activity, 250ms 隐藏后可见", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("SessionStart"));
    // 消抖期内隐藏
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(250);
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    const a = snap.activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.source).toBe("hook");
    agg.dispose();
  });

  it("PromptSubmit → status=processing 立即可见", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    const snap = agg.snapshot();
    const a = snap.activities[0] as AgentActivity;
    expect(a.status).toBe("processing");
    agg.dispose();
  });

  it("PermissionRequest → status=waiting", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("PermissionRequest"));
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("waiting");
    agg.dispose();
  });

  it("ToolStart / ToolComplete → status=tool", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("tool");
    agg.ingestAgentEvent(hookEvent("ToolComplete"));
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("tool");
    agg.dispose();
  });

  it("Stop → status=ready, 后续迟到 ToolStart 被吸收", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("Stop"));
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("ready");
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("ready");
    agg.dispose();
  });

  it("SessionEnd → activity 删除, 1500ms 短冷却拦迟到事件", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.ingestAgentEvent(hookEvent("SessionEnd"));
    expect(agg.snapshot().activities).toHaveLength(0);
    // 冷却期内迟到 Stop 被吞
    agg.ingestAgentEvent(hookEvent("Stop"));
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(1501);
    // 冷却过期后 SessionStart 豁免冷却重建
    agg.ingestAgentEvent(hookEvent("SessionStart"));
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("ingestCommandStarted with agent match → agent activity source=launch", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "codex --resume", "codex");
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.agentId).toBe("codex");
    expect(a.source).toBe("launch");
    agg.dispose();
  });

  it("ingestCommandStarted with no agent match → shell activity", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "ls -la", null);
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    const a = snap.activities[0];
    expect(a?.kind).toBe("shell");
    if (a?.kind === "shell") {
      expect(a.commandLine).toBe("ls -la");
    }
    agg.dispose();
  });

  it("ingestCommandFinished 正常退出 → 清活动, 5s 冷却", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "ls", null);
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.ingestCommandFinished("p1", 0);
    expect(agg.snapshot().activities).toHaveLength(0);
    // 5s 冷却期内新命令被拦
    agg.ingestCommandStarted("p1", "1", "pwd", null);
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(5001);
    agg.ingestCommandStarted("p1", "1", "pwd", null);
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("ingestCommandFinished 悬挂退出码 (147) → 保留活动（Ctrl+Z）", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.ingestCommandFinished("p1", 147);
    // 悬挂不视为 agent 退出
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("taskLaunched / taskFinished → task activity 生命周期", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", { taskId: "t1", label: "npm build" });
    let a = agg.snapshot().activities[0] as TaskActivity;
    expect(a.kind).toBe("task");
    expect(a.status).toBe("running");
    expect(a.label).toBe("npm build");
    agg.taskFinished("p1", { status: "success", exitCode: 0 });
    a = agg.snapshot().activities[0] as TaskActivity;
    expect(a.status).toBe("success");
    expect(a.exitCode).toBe(0);
    // 5s linger 后自然清理
    advance(5001);
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("taskLaunched 覆盖已有 agent activity（用户显式操作优先）", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    expect((agg.snapshot().activities[0] as AgentActivity).kind).toBe("agent");
    agg.taskLaunched("p1", "1", { taskId: "t1", label: "npm build" });
    const a = agg.snapshot().activities[0];
    expect(a?.kind).toBe("task");
    agg.dispose();
  });

  it("panelClosed 清活动 + 5s 冷却拦迟到 hook", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.panelClosed("p1");
    expect(agg.snapshot().activities).toHaveLength(0);
    // 冷却期内孤儿事件被吸收
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(5001);
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("retainPanels 只清不在集合内的面板", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "p1", "1"));
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "p2", "1"));
    expect(agg.snapshot().activities).toHaveLength(2);
    agg.retainPanels("1", ["p1"]);
    expect(agg.snapshot().activities).toHaveLength(1);
    expect(agg.snapshot().activities[0]?.panelId).toBe("p1");
    agg.dispose();
  });

  it("windowClosed 清空该窗口保留其他窗口", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "p1", "1"));
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "p2", "2"));
    agg.windowClosed("1");
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    expect(snap.activities[0]?.windowId).toBe("2");
    agg.dispose();
  });

  it("hook TTL 30min → agent status 回落 ready", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("processing");
    advance(30 * 60 * 1000);
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("ready");
    agg.dispose();
  });

  it("broadcast ts 严格单调（pull/push 同毫秒竞态不可能并列）", () => {
    const agg = createForegroundActivityAggregator({ now });
    const seen: number[] = [];
    agg.onChange((b) => seen.push(b.ts));
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    vi.advanceTimersByTime(100);
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    vi.advanceTimersByTime(100);
    agg.panelClosed("p1");
    vi.advanceTimersByTime(100);
    for (let i = 1; i < seen.length; i += 1) {
      const cur = seen[i];
      const prev = seen[i - 1];
      if (cur === undefined || prev === undefined) {
        throw new Error("undefined broadcast ts");
      }
      expect(cur).toBeGreaterThan(prev);
    }
    agg.dispose();
  });

  it("cooldown 期间同 key 事件不重建", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.panelClosed("p1");
    for (let i = 0; i < 5; i += 1) {
      agg.ingestAgentEvent(hookEvent("ToolStart"));
    }
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("ignoreNextNativeUserClose / consume shim", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ignoreNextNativeUserClose("p1");
    expect(agg.consumeIgnoreNativeUserClose("p1")).toBe(true);
    // 二次 consume 已消耗
    expect(agg.consumeIgnoreNativeUserClose("p1")).toBe(false);
    agg.dispose();
  });

  it("SubagentStart / SubagentStop 只计数, 不改父状态", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.status).toBe("tool");
    agg.ingestAgentEvent(hookEvent("SubagentStart"));
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.subagentCount).toBe(1);
    expect(a.status).toBe("tool");
    agg.ingestAgentEvent(hookEvent("SubagentStop"));
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.subagentCount).toBe(0);
    expect(a.status).toBe("tool");
    agg.dispose();
  });

  it("snapshot(windowId) 过滤只返回该窗口 activity", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "p1", "1"));
    agg.ingestAgentEvent(hookEvent("PromptSubmit", "p2", "2"));
    expect(agg.snapshot("1").activities).toHaveLength(1);
    expect(agg.snapshot("1").activities[0]?.windowId).toBe("1");
    expect(agg.snapshot("2").activities).toHaveLength(1);
    agg.dispose();
  });
});
