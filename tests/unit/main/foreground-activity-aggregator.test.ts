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

  it("agentLaunched → 建立 launch-source agent activity, 250ms 消抖后可见且无 status", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    // 消抖期内隐藏（瞬时命令不闪条）
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(250);
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    const a = snap.activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.agentId).toBe("codex");
    expect(a.source).toBe("launch");
    // launch 先验无 hook 证据 → 投影不带 status
    expect(a.status).toBeUndefined();
    expect(a.subagentCount).toBe(0);
    agg.dispose();
  });

  it("同 agent 双击去抖: launcher + OSC 二次 agentLaunched 不重置消抖 timer", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    advance(150);
    // OSC 133 C 匹配同 agent → 去抖, 不重置 250ms 消抖
    agg.ingestCommandStarted("p1", "1", "codex --resume", "codex");
    advance(100);
    // 距首次 launch 恰 250ms → 可见（若 timer 被重置此刻仍隐藏）
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("不同 agent 重 launch → 换新层, 重新 250ms 消抖", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    advance(150);
    agg.agentLaunched("1", "p1", "claude");
    // 首层的 250ms 已到, 但层已被替换 → 仍隐藏
    advance(100);
    expect(agg.snapshot().activities).toHaveLength(0);
    // 新层自建立起 250ms 后可见
    advance(150);
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.agentId).toBe("claude");
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

  it("ingestCommandStarted with agent match → 250ms 后 launch-source agent activity", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "codex --resume", "codex");
    advance(250);
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.agentId).toBe("codex");
    expect(a.source).toBe("launch");
    expect(a.status).toBeUndefined();
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

  it("ingestCommandFinished 正常退出 → 清活动, hook 冷却只拦迟到 hook 不拦新命令", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "ls", null);
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.ingestCommandFinished("p1", 0);
    expect(agg.snapshot().activities).toHaveLength(0);
    // 相邻命令 <5s：新 OSC 证据不受 hook 冷却拦截, 立即可见
    agg.ingestCommandStarted("p1", "1", "pwd", null);
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.ingestCommandFinished("p1", 0);
    expect(agg.snapshot().activities).toHaveLength(0);
    // 命令收尾后迟到 hook（ToolStart 属 SESSION_CREATING）5s 内被拦
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    expect(agg.snapshot().activities).toHaveLength(0);
    // 冷却过期后 PromptSubmit 重建 hook 会话
    advance(5001);
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("ingestCommandFinished 悬挂退出码 (147) → 保留活动（Ctrl+Z）", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    advance(250);
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
    advance(250);
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

  it("回归: 迟到 ToolComplete 不销毁已有 shell activity (acquireHookAgentEntry 顺序)", () => {
    const agg = createForegroundActivityAggregator({ now });
    // shell activity 先存在
    agg.ingestCommandStarted("p1", "1", "ls", null);
    expect(agg.snapshot().activities[0]?.kind).toBe("shell");
    // 迟到的 ToolComplete (非 SESSION_CREATING) 不应销毁 shell
    agg.ingestAgentEvent(hookEvent("ToolComplete"));
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    expect(snap.activities[0]?.kind).toBe("shell");
    agg.dispose();
  });

  it("回归: 迟到 Stop 不销毁 task activity", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", { taskId: "t1", label: "npm build" });
    agg.ingestAgentEvent(hookEvent("Stop"));
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    expect(snap.activities[0]?.kind).toBe("task");
    agg.dispose();
  });

  it("回归: agentLaunched 异 agent 清 hook 层 → 投影为新 agent launch", () => {
    const agg = createForegroundActivityAggregator({ now });
    // 建立 hook agent activity (claude) + tool status
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    const before = agg.snapshot().activities[0] as AgentActivity;
    expect(before.status).toBe("tool");
    expect(before.agentId).toBe("claude");
    // 异 agent 启动 → 旧 hook 证据作废 (clearAgentHookActivitiesBySession)
    agg.agentLaunched("1", "p1", "codex");
    // hook 层已清, 新 launch 层 250ms 消抖内隐藏 → 无 activity
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(250);
    const after = agg.snapshot().activities[0] as AgentActivity;
    expect(after.kind).toBe("agent");
    expect(after.source).toBe("launch");
    expect(after.agentId).toBe("codex");
    expect(after.status).toBeUndefined();
    agg.dispose();
  });

  it("回归: agentLaunched 同 agent 保留 hook 层 (证据与 TTL 不被 relaunch 清除)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("ToolStart"));
    // 同 agent 重启（如 claude --resume）→ hook 证据延续, 不清层
    agg.agentLaunched("1", "p1", "claude");
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.source).toBe("hook");
    expect(a.agentId).toBe("claude");
    expect(a.status).toBe("tool");
    // hook TTL 不因 relaunch 重置：30min 静默照常衰减 ready
    advance(30 * 60 * 1000);
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.source).toBe("hook");
    expect(a.status).toBe("ready");
    agg.dispose();
  });

  it("回归: taskFinished 双次调用 linger 幂等 (第二次不重置 timer)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", { taskId: "t1", label: "test" });
    agg.taskFinished("p1", { status: "success", exitCode: 0 });
    // linger 已启动, 3s 后二次 taskFinished
    advance(3000);
    agg.taskFinished("p1", { status: "failure", exitCode: 1 });
    // 从第一次调用起再 2001ms (总 5001ms) → 首次 linger 到期 → activity 应清
    advance(2001);
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("回归: shell 冷却期内新命令被拦截 (panelClosed 后 5s 内 ingestCommandStarted)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "ls", null);
    agg.panelClosed("p1");
    expect(agg.snapshot().activities).toHaveLength(0);
    // 冷却期内新 shell 命令被拦
    agg.ingestCommandStarted("p1", "1", "pwd", null);
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(5001);
    agg.ingestCommandStarted("p1", "1", "ps", null);
    expect(agg.snapshot().activities).toHaveLength(1);
    expect(agg.snapshot().activities[0]?.kind).toBe("shell");
    agg.dispose();
  });

  it("回归: panelClosed 后 5s 内 SessionStart 不得重建 (panel 死亡冷却不豁免)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.panelClosed("p1");
    expect(agg.snapshot().activities).toHaveLength(0);
    // 幽灵防复活：panel 冷却期内 SessionStart 也被拦（过消抖窗仍无 activity）
    agg.ingestAgentEvent(hookEvent("SessionStart"));
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(0);
    // panel 冷却过期后 SessionStart 才能重建
    advance(4751);
    agg.ingestAgentEvent(hookEvent("SessionStart"));
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(1);
    agg.dispose();
  });

  it("回归: SessionEnd 后 1.5s 内新 shell 命令立即可见 (hook 冷却不拦命令)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    agg.ingestAgentEvent(hookEvent("SessionEnd"));
    expect(agg.snapshot().activities).toHaveLength(0);
    // hook 收尾冷却只 gate hook 层——新 shell 命令是新鲜 OSC 证据
    agg.ingestCommandStarted("p1", "1", "ls -la", null);
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    expect(snap.activities[0]?.kind).toBe("shell");
    agg.dispose();
  });

  it("回归: windowClosed 清 taskLingerTimer (无残留 timer)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", { taskId: "t1", label: "test" });
    agg.taskFinished("p1", { status: "success", exitCode: 0 });
    agg.windowClosed("1");
    expect(agg.snapshot().activities).toHaveLength(0);
    // linger timer 应已清; advance 后不应有幽灵 emit / 状态复活
    advance(6000);
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("回归: commandStart/Finished hook stub 无副作用 no-op (保 discriminated union)", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(1);
    // stub 通道不应改变 activity 状态
    agg.ingestCommandStartHook({
      v: 1,
      kind: "commandStart",
      panelId: "p1",
      windowId: "1",
      commandLine: "test",
    });
    agg.ingestCommandFinishedHook({
      v: 1,
      kind: "commandFinished",
      panelId: "p1",
      windowId: "1",
      exitCode: 0,
    });
    expect(agg.snapshot().activities).toHaveLength(1);
    expect(agg.snapshot().activities[0]?.kind).toBe("agent");
    agg.dispose();
  });

  it("回归: omp update → agent match 250ms 后可见且无 status, 正常退出清空", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestCommandStarted("p1", "1", "omp update", "omp");
    // 消抖期内隐藏
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(250);
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.agentId).toBe("omp");
    expect(a.source).toBe("launch");
    expect(a.status).toBeUndefined();
    agg.ingestCommandFinished("p1", 0);
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("回归: 瞬时命令不闪条 — 消抖期内退出全程不可见, 消抖 timer 不复活", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    expect(agg.snapshot().activities).toHaveLength(0);
    advance(200);
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.ingestCommandFinished("p1", 0);
    expect(agg.snapshot().activities).toHaveLength(0);
    // 消抖 timer 不得在层清除后复活条目
    advance(250);
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("hook 证据优先于 launch 先验: PromptSubmit 立即可见并压过消抖中的 launch", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    // hook 证据立即显形, 无须等 launch 消抖
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.source).toBe("hook");
    expect(a.status).toBe("processing");
    expect(a.agentId).toBe("claude");
    agg.dispose();
  });

  it("回归: fg 不摧毁挂起会话 — Ctrl+Z 后 shell 命令只盖 command 层", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    expect((agg.snapshot().activities[0] as AgentActivity).status).toBe(
      "processing"
    );
    // Ctrl+Z 悬挂：双层保留
    agg.ingestCommandFinished("p1", 147);
    // `fg`（无 agent match）只覆盖 command 层, hook 证据保留
    agg.ingestCommandStarted("p1", "1", "fg", null);
    const a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.source).toBe("hook");
    expect(a.status).toBe("processing");
    agg.dispose();
  });

  it("SessionEnd 只清 hook 层: 投影回落 launch icon-only, 命令退出后全清", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.agentLaunched("1", "p1", "codex");
    advance(250);
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    let a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.source).toBe("hook");
    agg.ingestAgentEvent(hookEvent("SessionEnd"));
    // hook 清除, command 层保留 → 回落 launch 先验（无 status）
    a = agg.snapshot().activities[0] as AgentActivity;
    expect(a.kind).toBe("agent");
    expect(a.source).toBe("launch");
    expect(a.agentId).toBe("codex");
    expect(a.status).toBeUndefined();
    // 前台命令最终退出 → 全清
    agg.ingestCommandFinished("p1", 0);
    expect(agg.snapshot().activities).toHaveLength(0);
    agg.dispose();
  });

  it("task 压住 hook 投影: task 在场时 hook 事件仍建 hook 层但投影为 task", () => {
    const agg = createForegroundActivityAggregator({ now });
    agg.taskLaunched("p1", "1", { taskId: "t1", label: "npm build" });
    agg.ingestAgentEvent(hookEvent("PromptSubmit"));
    const snap = agg.snapshot();
    expect(snap.activities).toHaveLength(1);
    expect(snap.activities[0]?.kind).toBe("task");
    agg.dispose();
  });
});
