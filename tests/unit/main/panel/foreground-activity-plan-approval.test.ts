import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV3,
} from "@shared/contracts/agent/session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";
import {
  CLAUDE_FAMILY_INTERACTIVE_BLOCKING_TOOLS,
  GROK_INTERACTIVE_BLOCKING_TOOLS,
} from "../../../../src/main/services/agents/integrations/interactive-blocking-tools.ts";
import { createForegroundActivityAggregator as createRawForegroundActivityAggregator } from "../../../../src/main/services/foreground-activity/aggregator.ts";
import {
  isInteractiveBlockingToolName,
  PLAN_APPROVAL_TOOL_NAMES,
  QUESTION_TOOL_NAMES,
} from "../../../../src/main/services/foreground-activity/plan-approval.ts";
import type {
  AgentEventIngestOptions,
  ForegroundActivityAggregator,
} from "../../../../src/main/services/foreground-activity/types.ts";

const DEFAULT_INGEST_OPTIONS: AgentEventIngestOptions = {
  evidenceSource: "hook",
  stopAuthority: "authoritative",
  turnStartAuthority: "none",
};

function ingest(
  aggregator: ForegroundActivityAggregator,
  event: AgentHookEventPayload
): boolean {
  return aggregator.ingestAgentEvent(event, DEFAULT_INGEST_OPTIONS);
}

function statusOf(
  aggregator: ForegroundActivityAggregator
): AgentActivity["status"] | undefined {
  return (aggregator.snapshot().activities[0] as AgentActivity | undefined)
    ?.status;
}

function planRequested(
  interactionId: string,
  toolName: string,
  agent: "claude" | "grok" = "grok"
): AgentHookEventPayloadV3 {
  return {
    agent,
    event: "InteractionRequested",
    interactionId,
    interactionKind: "permission",
    kind: "agentEvent",
    nativeEvent: "PreToolUse",
    panelId: "p1",
    toolName,
    toolUseId: interactionId,
    v: 3,
    windowId: "1",
  };
}

function planResolved(
  interactionId: string,
  toolName: string
): AgentHookEventPayloadV3 {
  return {
    agent: "grok",
    event: "InteractionResolved",
    interactionId,
    interactionKind: "permission",
    interactionOutcome: "completed",
    kind: "agentEvent",
    nativeEvent: "PostToolUse",
    panelId: "p1",
    toolName,
    toolUseId: interactionId,
    v: 3,
    windowId: "1",
  };
}

function toolStart(toolUseId: string, toolName: string): AgentHookEventPayload {
  return {
    agent: "grok",
    event: "ToolStart",
    kind: "agentEvent",
    panelId: "p1",
    toolName,
    toolUseId,
    v: 1,
    windowId: "1",
  };
}

function questionRequested(interactionId: string): AgentHookEventPayloadV3 {
  return {
    agent: "grok",
    event: "InteractionRequested",
    interactionId,
    interactionKind: "question",
    kind: "agentEvent",
    nativeEvent: "PreToolUse",
    panelId: "p1",
    toolName: "ask_user_question",
    toolUseId: interactionId,
    v: 3,
    windowId: "1",
  };
}

function questionResolved(interactionId: string): AgentHookEventPayloadV3 {
  return {
    agent: "grok",
    event: "InteractionResolved",
    interactionId,
    interactionKind: "question",
    interactionOutcome: "completed",
    kind: "agentEvent",
    nativeEvent: "PostToolUse",
    panelId: "p1",
    toolName: "ask_user_question",
    toolUseId: interactionId,
    v: 3,
    windowId: "1",
  };
}

function permissionRequested(interactionId: string): AgentHookEventPayloadV3 {
  return {
    agent: "grok",
    event: "InteractionRequested",
    interactionId,
    interactionKind: "permission",
    kind: "agentEvent",
    nativeEvent: "PreToolUse",
    panelId: "p1",
    v: 3,
    windowId: "1",
  };
}

describe("plan 审批交互的隐式结算", () => {
  it("exit_plan_mode 被丢掉后，后续普通 ToolStart 离开 waiting", () => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, planRequested("plan-1", "exit_plan_mode"));
    expect(statusOf(aggregator)).toBe("waiting");

    ingest(aggregator, toolStart("grep-1", "grep"));
    expect(statusOf(aggregator)).toBe("tool");
    aggregator.dispose();
  });

  it("请求修改再批准后，执行工具不再停留在 waiting", () => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, planRequested("plan-1", "exit_plan_mode"));
    ingest(aggregator, toolStart("grep-1", "grep"));
    ingest(aggregator, planRequested("plan-2", "exit_plan_mode"));
    ingest(aggregator, toolStart("read-1", "read_file"));
    ingest(aggregator, planRequested("plan-3", "exit_plan_mode"));
    ingest(aggregator, planResolved("plan-3", "exit_plan_mode"));
    ingest(aggregator, toolStart("grep-2", "grep"));

    expect(statusOf(aggregator)).toBe("tool");
    aggregator.dispose();
  });

  it("多次出示 plan 只批准最后一次后离开 waiting", () => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, planRequested("plan-1", "exit_plan_mode"));
    ingest(aggregator, planRequested("plan-2", "exit_plan_mode"));
    ingest(aggregator, planRequested("plan-3", "exit_plan_mode"));
    ingest(aggregator, planResolved("plan-3", "exit_plan_mode"));

    expect(statusOf(aggregator)).toBe("processing");
    aggregator.dispose();
  });

  it("EnterPlanMode / enter_plan_mode 同样可被后续工具顶替", () => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, planRequested("enter-1", "EnterPlanMode"));
    ingest(aggregator, toolStart("read-1", "Read"));
    expect(statusOf(aggregator)).toBe("tool");
    aggregator.dispose();
  });

  it("Claude ExitPlanMode 拒绝后 PromptSubmit 清掉 waiting", () => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, planRequested("exit-1", "ExitPlanMode", "claude"));
    expect(statusOf(aggregator)).toBe("waiting");
    ingest(aggregator, {
      agent: "claude",
      event: "PromptSubmit",
      kind: "agentEvent",
      panelId: "p1",
      v: 1,
      windowId: "1",
    });
    expect(statusOf(aggregator)).toBe("processing");
    aggregator.dispose();
  });

  it("OpenCode/Codex 式无名 permission 不能被后续 ToolStart 顶替", () => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, questionRequested("ask-1"));
    ingest(aggregator, toolStart("grep-1", "grep"));
    expect(statusOf(aggregator)).toBe("waiting");

    ingest(aggregator, permissionRequested("perm-1"));
    ingest(aggregator, toolStart("grep-2", "grep"));
    expect(statusOf(aggregator)).toBe("waiting");
    aggregator.dispose();
  });

  it("plan 审批名单覆盖 Claude / Grok 的 permission 工具名", () => {
    const catalogNames = [
      ...CLAUDE_FAMILY_INTERACTIVE_BLOCKING_TOOLS,
      ...GROK_INTERACTIVE_BLOCKING_TOOLS,
    ].flatMap((entry) =>
      entry.interactionKind === "permission" ? [...entry.toolNames] : []
    );
    expect([...PLAN_APPROVAL_TOOL_NAMES].toSorted()).toEqual(
      [...new Set(catalogNames)].toSorted()
    );
  });
});

describe("问卷不得仅凭 ToolStart 升 waiting", () => {
  it.each([
    "ask",
    "ask_user",
    "ask_user_question",
    "AskUserQuestion",
    "AskQuestion",
    "ask_question",
    "clarify",
    "request_user_input",
    "request_permissions",
  ])("ToolStart(%s) 保持 tool，不伪造 waiting", (toolName) => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, toolStart("ask-1", toolName));
    expect(statusOf(aggregator)).toBe("tool");
    aggregator.dispose();
  });

  it.each([
    "exit_plan_mode",
    "ExitPlanMode",
  ])("ToolStart(%s) 仍进入 waiting（plan 丢失 Post 的回退）", (toolName) => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, toolStart("plan-1", toolName));
    expect(statusOf(aggregator)).toBe("waiting");
    aggregator.dispose();
  });

  it("具名问卷 InteractionResolved 结束 waiting", () => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, questionRequested("ask-1"));
    expect(statusOf(aggregator)).toBe("waiting");
    ingest(aggregator, questionResolved("ask-1"));
    expect(statusOf(aggregator)).toBe("processing");
    aggregator.dispose();
  });

  it("Gemini ask_user 只有工具生命周期，不进 waiting", () => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, {
      agent: "gemini",
      event: "ToolStart",
      kind: "agentEvent",
      panelId: "p1",
      toolName: "ask_user",
      v: 1,
      windowId: "1",
    });
    expect(statusOf(aggregator)).toBe("tool");

    ingest(aggregator, {
      agent: "gemini",
      event: "ToolComplete",
      kind: "agentEvent",
      panelId: "p1",
      toolName: "ask_user",
      v: 1,
      windowId: "1",
    });
    expect(statusOf(aggregator)).toBe("processing");
    aggregator.dispose();
  });

  it("具名 InteractionRequested 问卷仍优先于随后的普通 ToolStart", () => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, questionRequested("ask-1"));
    ingest(aggregator, toolStart("ask-1", "ask_user_question"));
    ingest(aggregator, toolStart("grep-1", "grep"));
    expect(statusOf(aggregator)).toBe("waiting");
    aggregator.dispose();
  });

  it("ToolStart 之后的具名 InteractionRequested 不再被普通工具顶替", () => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, toolStart("ask-1", "request_user_input"));
    ingest(aggregator, questionRequested("ask-1"));
    ingest(aggregator, toolStart("grep-1", "grep"));
    expect(statusOf(aggregator)).toBe("waiting");
    aggregator.dispose();
  });

  it("ToolStart(request_permissions) 后的具名 permission 不能被普通工具顶替", () => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, toolStart("perm-1", "request_permissions"));
    ingest(aggregator, permissionRequested("perm-1"));
    ingest(aggregator, toolStart("grep-1", "grep"));
    expect(statusOf(aggregator)).toBe("waiting");
    aggregator.dispose();
  });

  it("废弃的 plan 被后续问卷顶替，答完问卷离开 waiting", () => {
    const aggregator = createRawForegroundActivityAggregator();
    ingest(aggregator, planRequested("plan-1", "exit_plan_mode"));
    ingest(aggregator, questionRequested("ask-1"));
    ingest(aggregator, questionResolved("ask-1"));
    expect(statusOf(aggregator)).toBe("processing");
    aggregator.dispose();
  });

  it("问卷名单含各家阻塞工具，且不并入 plan 审批表", () => {
    const questionNames = [
      ...CLAUDE_FAMILY_INTERACTIVE_BLOCKING_TOOLS,
      ...GROK_INTERACTIVE_BLOCKING_TOOLS,
    ].flatMap((entry) =>
      entry.interactionKind === "question" ? [...entry.toolNames] : []
    );
    for (const name of questionNames) {
      expect(QUESTION_TOOL_NAMES.has(name), name).toBe(true);
      expect(PLAN_APPROVAL_TOOL_NAMES.has(name), name).toBe(false);
    }
    for (const name of [
      "ask",
      "ask_user",
      "AskQuestion",
      "ask_question",
      "clarify",
      "request_user_input",
      "request_permissions",
    ]) {
      expect(isInteractiveBlockingToolName(name), name).toBe(true);
      expect(PLAN_APPROVAL_TOOL_NAMES.has(name), name).toBe(false);
    }
    expect(isInteractiveBlockingToolName("grep")).toBe(false);
  });
});
