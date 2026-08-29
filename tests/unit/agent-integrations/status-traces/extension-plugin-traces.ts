import {
  buildOmpExtensionSource,
  ompIntegration,
} from "@main/services/agents/integrations/omp.ts";
import {
  buildPiExtensionSource,
  piIntegration,
} from "@main/services/agents/integrations/pi.ts";
import { createExtensionPluginProducer } from "./extension-plugin-driver.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceCheckpoint,
  AgentStatusTraceFixture,
} from "./status-trace-types.ts";

function extensionAction(
  nativeEvent: string,
  event: AgentStatusTraceCheckpoint["expectedEvent"],
  dimension: AgentStatusTraceCheckpoint["dimension"],
  expected: Omit<
    AgentStatusTraceCheckpoint,
    "dimension" | "expectedEvent" | "expectedNativeEvent"
  >,
  sessionId: string,
  eventPayload: Record<string, unknown> = {},
  producerKey = nativeEvent
): AgentStatusTraceAction {
  const { expectedEventFields, ...expectedCheckpoint } = expected;
  return {
    checkpoints: [
      {
        dimension,
        expectedEvent: event,
        ...expectedCheckpoint,
        expectedEventFields: {
          sessionId,
          ...expectedEventFields,
        },
        expectedNativeEvent: nativeEvent,
      },
    ],
    expectedNativeEvents: [nativeEvent],
    nativeEvent,
    payload: { event: eventPayload, sessionId },
    producerKey,
  };
}

const piActions: AgentStatusTraceAction[] = [
  extensionAction(
    "session_start",
    "SessionStart",
    "lifecycle",
    { expectedStatusAbsent: true },
    "pi-session-1"
  ),
  extensionAction(
    "before_agent_start",
    "PromptSubmit",
    "processing",
    { expectedStatus: "processing" },
    "pi-session-1",
    { prompt: "Inspect status" }
  ),
  extensionAction(
    "tool_execution_start",
    "ToolStart",
    "tool",
    {
      expectedEventFields: { toolUseId: "pi-tool-1" },
      expectedStatus: "tool",
    },
    "pi-session-1",
    { toolCallId: "pi-tool-1", toolName: "bash" }
  ),
  extensionAction(
    "tool_execution_end",
    "ToolComplete",
    "processing",
    {
      expectedEventFields: { toolUseId: "pi-tool-1" },
      expectedStatus: "processing",
    },
    "pi-session-1",
    { isError: false, toolCallId: "pi-tool-1", toolName: "bash" }
  ),
  // pi 的 waiting 来源是专为状态集成设计的 ui_prompt_start/end
  // （docs/extensions.md；2026-08-29 移除误植的 ask 分支——ask 是 omp
  // 自有工具）。上游深度计数保证最外层严格 1:1 配对，匿名交互计数安全。
  extensionAction(
    "ui_prompt_start",
    "InteractionRequested",
    "waiting",
    {
      expectedEventFields: {
        interactionKind: "question",
        nativeState: "select",
      },
      expectedStatus: "waiting",
    },
    "pi-session-1",
    { kind: "select", title: "选择分支" }
  ),
  extensionAction(
    "ui_prompt_end",
    "InteractionResolved",
    "processing",
    {
      expectedEventFields: {
        interactionKind: "question",
        interactionOutcome: "completed",
        nativeState: "select",
      },
      expectedStatus: "processing",
    },
    "pi-session-1",
    { kind: "select", title: "选择分支" }
  ),
  extensionAction(
    "agent_settled",
    "Stop",
    "ready",
    { expectedStatus: "ready" },
    "pi-session-1"
  ),
  extensionAction(
    "session_shutdown",
    "SessionEnd",
    "lifecycle",
    { expectedAbsent: true },
    "pi-session-1"
  ),
];

const ompActions: AgentStatusTraceAction[] = [
  extensionAction(
    "session_start",
    "SessionStart",
    "lifecycle",
    { expectedStatusAbsent: true },
    "omp-session-1"
  ),
  extensionAction(
    "before_agent_start",
    "PromptSubmit",
    "processing",
    { expectedStatus: "processing" },
    "omp-session-1",
    { prompt: "Inspect status" }
  ),
  extensionAction(
    "tool_execution_start",
    "ToolStart",
    "tool",
    {
      expectedEventFields: { toolUseId: "omp-tool-1" },
      expectedStatus: "tool",
    },
    "omp-session-1",
    { toolCallId: "omp-tool-1", toolName: "bash" }
  ),
  extensionAction(
    "tool_execution_end",
    "ToolComplete",
    "processing",
    {
      expectedEventFields: { toolUseId: "omp-tool-1" },
      expectedStatus: "processing",
    },
    "omp-session-1",
    { isError: false, toolCallId: "omp-tool-1", toolName: "bash" }
  ),
  extensionAction(
    "tool_approval_requested",
    "InteractionRequested",
    "waiting",
    {
      expectedEventFields: { interactionId: "approval-1" },
      expectedStatus: "waiting",
    },
    "omp-session-1",
    { toolCallId: "approval-1" }
  ),
  extensionAction(
    "tool_approval_resolved",
    "InteractionResolved",
    "processing",
    {
      expectedEventFields: {
        interactionId: "approval-1",
        interactionOutcome: "rejected",
      },
      expectedStatus: "processing",
    },
    "omp-session-1",
    { approved: false, toolCallId: "approval-1" }
  ),
  extensionAction(
    "agent_end.completed",
    "TurnCompleted",
    "completed",
    { expectedStatus: "ready" },
    "omp-session-1",
    {
      messages: [{ role: "assistant", stopReason: "completed" }],
      willContinue: false,
    },
    "agent_end"
  ),
  {
    ...extensionAction(
      "session_stop",
      "Stop",
      "ready",
      { expectedStatus: "ready" },
      "omp-session-1"
    ),
    checkpoints: [],
    expectedIngest: false,
    scenarios: ["late-event"],
  },
  extensionAction(
    "session_start",
    "SessionStart",
    "lifecycle",
    { expectedStatusAbsent: true },
    "omp-session-2"
  ),
  extensionAction(
    "before_agent_start",
    "PromptSubmit",
    "processing",
    { expectedStatus: "processing" },
    "omp-session-2",
    { prompt: "Inspect interruption" }
  ),
  {
    ...extensionAction(
      "agent_end.aborted",
      "TurnInterrupted",
      "interrupted",
      { expectedStatus: "ready" },
      "omp-session-2",
      {
        messages: [{ role: "assistant", stopReason: "aborted" }],
        willContinue: false,
      },
      "agent_end"
    ),
    checkpoints: [
      {
        dimension: "ready",
        expectedEvent: "TurnInterrupted",
        expectedEventFields: { sessionId: "omp-session-2" },
        expectedNativeEvent: "agent_end.aborted",
        expectedStatus: "ready",
      },
      {
        dimension: "interrupted",
        expectedEvent: "TurnInterrupted",
        expectedEventFields: { sessionId: "omp-session-2" },
        expectedNativeEvent: "agent_end.aborted",
        expectedStatus: "ready",
      },
    ],
    scenarios: ["interrupted"],
  },
  // ── 2026-08-25 事故回归：abort 封账后的静默续跑不得冻在 ready ──
  // steer/follow-up drain 与 IRC 唤醒不开新 before_agent_start，
  // agent_start（loop 启动）是唯一重开信号；toolUse 让位不落终态。
  extensionAction(
    "agent_start",
    "processing",
    "processing",
    { expectedStatus: "processing" },
    "omp-session-2"
  ),
  extensionAction(
    "tool_execution_start",
    "ToolStart",
    "tool",
    {
      expectedEventFields: { toolUseId: "omp-tool-2" },
      expectedStatus: "tool",
    },
    "omp-session-2",
    { toolCallId: "omp-tool-2", toolName: "read" }
  ),
  extensionAction(
    "tool_execution_end",
    "ToolComplete",
    "processing",
    {
      expectedEventFields: { toolUseId: "omp-tool-2" },
      expectedStatus: "processing",
    },
    "omp-session-2",
    { isError: false, toolCallId: "omp-tool-2", toolName: "read" }
  ),
  extensionAction(
    "agent_end.toolUseDeferred",
    "processing",
    "processing",
    { expectedStatus: "processing" },
    "omp-session-2",
    {
      messages: [{ role: "assistant", stopReason: "toolUse" }],
      willContinue: false,
    },
    "agent_end"
  ),
  extensionAction(
    "agent_end.completed",
    "TurnCompleted",
    "completed",
    { expectedStatus: "ready" },
    "omp-session-2",
    {
      messages: [{ role: "assistant", stopReason: "stop" }],
      willContinue: false,
    },
    "agent_end"
  ),
  extensionAction(
    "session_start",
    "SessionStart",
    "lifecycle",
    { expectedStatusAbsent: true },
    "omp-session-3"
  ),
  {
    ...extensionAction(
      "agent_end.error",
      "error",
      "error",
      { expectedStatus: "error" },
      "omp-session-3",
      {
        messages: [{ role: "assistant", stopReason: "error" }],
        willContinue: false,
      },
      "agent_end"
    ),
    scenarios: ["error"],
  },
  extensionAction(
    "session_shutdown",
    "SessionEnd",
    "lifecycle",
    { expectedStatus: "ready" },
    "omp-session-3"
  ),
];

export const EXTENSION_PLUGIN_STATUS_TRACES = [
  {
    actions: piActions,
    agentId: "pi",
    covers: ["lifecycle", "ready", "processing", "tool", "waiting"],
    createProducer: () =>
      createExtensionPluginProducer("pi", buildPiExtensionSource()),
    stopAuthority: piIntegration.runtime.stopAuthority,
  },
  {
    actions: ompActions,
    agentId: "omp",
    covers: [
      "lifecycle",
      "ready",
      "processing",
      "tool",
      "waiting",
      "error",
      "completed",
      "interrupted",
    ],
    createProducer: () =>
      createExtensionPluginProducer("omp", buildOmpExtensionSource()),
    stopAuthority: ompIntegration.runtime.stopAuthority,
  },
] as const satisfies readonly AgentStatusTraceFixture[];
