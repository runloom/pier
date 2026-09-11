import { kimiIntegration } from "@main/services/agents/integrations/kimi.ts";
import type {
  AgentStatusTraceCheckpoint,
  AgentStatusTraceFixture,
} from "../status-trace-types.ts";
import {
  createKimiTraceProducer,
  type KimiTraceAction,
} from "./kimi-driver.ts";

// Kimi Code 0.41.0：脱敏后的主 wire 结构与 hook 次序。
// 原生来源：MoonshotAI/kimi-code baf17a8，externalHooks/agentExternalHooksService.ts
// 与 wire-manifest.d.ts；本地事故证据显示连续回合没有 UserPromptSubmit。
function hook(
  nativeEvent: string,
  expectedEvent: AgentStatusTraceCheckpoint["expectedEvent"],
  dimension: AgentStatusTraceCheckpoint["dimension"],
  expected: Partial<AgentStatusTraceCheckpoint>,
  payload: Record<string, unknown> = {}
): KimiTraceAction {
  return {
    nativeEvent,
    expectedNativeEvents: [nativeEvent],
    payload: {
      hook_event_name: nativeEvent,
      session_id: "session-1",
      ...payload,
    },
    checkpoints: [
      {
        dimension,
        expectedEvent,
        expectedNativeEvent: nativeEvent,
        expectedEventFields: { sessionId: "session-1" },
        expectedEventFieldsAbsent: ["turnId"],
        ...expected,
      },
    ],
  };
}

function tool(
  action: "PreToolUse" | "PostToolUse",
  id: string,
  name: string,
  status: "processing" | "tool" | "waiting"
): KimiTraceAction {
  return hook(
    action,
    action === "PreToolUse" ? "ToolStart" : "ToolComplete",
    status,
    {
      expectedStatus: status,
      expectedEventFields: {
        sessionId: "session-1",
        toolUseId: id,
        toolName: name,
      },
    },
    { tool_call_id: id, tool_name: name }
  );
}

function call(
  turnId: number,
  toolCallId: string,
  name: string
): Record<string, unknown> {
  return {
    type: "context.append_loop_event",
    event: {
      type: "tool.call",
      turnId: String(turnId),
      toolCallId,
      name,
    },
  };
}

function start(turnId: number): Record<string, unknown>[] {
  return [
    { type: "turn.prompt", origin: { kind: "user" }, input: [] },
    {
      type: "context.append_loop_event",
      event: { type: "step.begin", turnId: String(turnId), step: 1 },
    },
  ];
}

function stop(nativeEvent = "Stop"): KimiTraceAction {
  return {
    nativeEvent,
    expectedNativeEvents: [nativeEvent],
    expectedIngest: false,
    payload: {
      hook_event_name: nativeEvent,
      session_id: "session-1",
      stop_hook_active: false,
      error_type: "ModelError",
      error_message: "provider request failed",
    },
    eventAssertions: [
      { expectedEvent: "Stop", expectedNativeEvent: nativeEvent },
    ],
    checkpoints: [],
    scenarios: ["main-subagent-interleave"],
  };
}

function terminal(
  turnId: number,
  reason: "completed" | "cancelled"
): KimiTraceAction {
  const nativeEvent = `kimi.wire.turn.ended.${reason}`;
  return {
    nativeEvent,
    expectedNativeEvents: [nativeEvent],
    producerKey: "transcript",
    payload: { type: "turn.ended", turnId, reason },
    checkpoints: (
      ["ready", reason === "completed" ? "completed" : "interrupted"] as const
    ).map((dimension) => ({
      dimension,
      expectedEvent:
        reason === "completed" ? "TurnCompleted" : "TurnInterrupted",
      expectedNativeEvent: nativeEvent,
      expectedStatus: "ready",
      expectedEventFields: { sessionId: "session-1", turnId: String(turnId) },
    })),
    scenarios: reason === "cancelled" ? ["interrupted"] : [],
  };
}

const actions: KimiTraceAction[] = [
  hook("SessionStart", "SessionStart", "lifecycle", {
    expectedStatusAbsent: true,
  }),
];
for (const [index, id] of ["helper-a", "helper-b"].entries()) {
  actions.push(
    {
      ...tool("PreToolUse", id, "Agent", "tool"),
      wireBefore: [...(index === 0 ? start(0) : []), call(0, id, "Agent")],
    },
    hook(
      "SubagentStart",
      "SubagentStart",
      "subagent",
      {
        expectedStatus: "tool",
        expectedSubagentCount: index + 1,
      },
      { agent_name: "Explore" }
    )
  );
}
for (const [index, id] of ["helper-a", "helper-b"].entries()) {
  actions.push(
    stop(),
    stop("StopFailure"),
    hook(
      "SubagentStop",
      "SubagentStop",
      "subagent",
      {
        expectedStatus: "tool",
        expectedSubagentCount: 1 - index,
      },
      { agent_name: "Explore" }
    ),
    tool("PostToolUse", id, "Agent", index === 0 ? "tool" : "processing")
  );
}
actions.push(
  {
    ...tool("PreToolUse", "write", "Write", "tool"),
    wireBefore: [call(0, "write", "Write")],
  },
  {
    ...hook(
      "PreToolUse",
      "InteractionRequested",
      "waiting",
      {
        expectedStatus: "waiting",
        expectedEventFields: {
          interactionId: "question",
          interactionKind: "question",
          toolName: "AskUserQuestion",
        },
      },
      { tool_name: "AskUserQuestion", tool_call_id: "question" }
    ),
    wireBefore: [call(0, "question", "AskUserQuestion")],
  },
  stop(),
  tool("PostToolUse", "write", "Write", "waiting"),
  {
    ...hook(
      "PostToolUse",
      "InteractionResolved",
      "processing",
      {
        expectedStatus: "processing",
        expectedEventFields: {
          interactionId: "question",
          interactionKind: "question",
          interactionOutcome: "completed",
        },
      },
      { tool_name: "AskUserQuestion", tool_call_id: "question" }
    ),
    scenarios: ["resume-after-waiting"],
  },
  {
    ...hook("PreCompact", "processing", "processing", {
      expectedStatus: "processing",
    }),
    scenarios: ["compaction"],
  },
  stop(),
  terminal(0, "completed"),
  {
    ...tool("PreToolUse", "second-write", "Write", "tool"),
    wireBefore: [...start(1), call(1, "second-write", "Write")],
  },
  tool("PostToolUse", "second-write", "Write", "processing"),
  terminal(1, "cancelled"),
  {
    ...stop("StopFailure"),
    wireBefore: [
      ...start(2),
      { type: "turn.ended", turnId: 2, reason: "failed" },
    ],
  },
  {
    nativeEvent: "kimi.wire.turn.ended.failed",
    expectedNativeEvents: ["kimi.wire.turn.ended.failed"],
    producerKey: "transcript",
    // 已在 hook 之前落盘；本步只等待对账输出，覆盖无工具的失败次序。
    payload: null,
    checkpoints: [
      {
        dimension: "error",
        expectedEvent: "error",
        expectedNativeEvent: "kimi.wire.turn.ended.failed",
        expectedStatus: "error",
        expectedEventFields: { turnId: "2", sessionId: "session-1" },
      },
    ],
    scenarios: ["error"],
  },
  hook("SessionEnd", "SessionEnd", "lifecycle", { expectedAbsent: true })
);

export const KIMI_RECONCILER_TRACE: AgentStatusTraceFixture = {
  agentId: "kimi",
  actions,
  covers: [
    "lifecycle",
    "processing",
    "tool",
    "waiting",
    "ready",
    "completed",
    "interrupted",
    "subagent",
    "error",
  ],
  createProducer: createKimiTraceProducer,
  stopAuthority: kimiIntegration.runtime.stopAuthority,
};
