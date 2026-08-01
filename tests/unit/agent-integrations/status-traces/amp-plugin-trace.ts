import { ampIntegration } from "@main/services/agents/integrations/amp.ts";
import { createAmpPluginProducer } from "./amp-plugin-driver.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceCheckpoint,
  AgentStatusTraceFixture,
  AgentStatusTraceScenario,
} from "./status-trace-types.ts";

function ampAction(
  nativeEvent: string,
  event: AgentStatusTraceCheckpoint["expectedEvent"],
  dimension: AgentStatusTraceCheckpoint["dimension"],
  expected: Omit<
    AgentStatusTraceCheckpoint,
    "dimension" | "expectedEvent" | "expectedNativeEvent"
  >,
  payload: Record<string, unknown>,
  producerKey?: string,
  scenarios: readonly AgentStatusTraceScenario[] = [],
  expectedNativeEvents: readonly string[] = [nativeEvent]
): AgentStatusTraceAction {
  return {
    checkpoints: [
      {
        dimension,
        expectedEvent: event,
        expectedNativeEvent: nativeEvent,
        ...expected,
      },
    ],
    expectedNativeEvents,
    nativeEvent,
    payload,
    ...(producerKey ? { producerKey } : {}),
    scenarios,
  };
}

function ampTerminal(
  nativeEvent: string,
  event: "TurnCompleted" | "TurnInterrupted",
  dimension: "completed" | "interrupted",
  sessionId: string,
  scenarios: readonly AgentStatusTraceScenario[] = []
): AgentStatusTraceAction {
  return {
    checkpoints: [
      {
        dimension: "ready",
        expectedEvent: event,
        expectedEventFields: { sessionId },
        expectedNativeEvent: nativeEvent,
        expectedStatus: "ready",
      },
      {
        dimension,
        expectedEvent: event,
        expectedEventFields: { sessionId },
        expectedNativeEvent: nativeEvent,
        expectedStatus: "ready",
      },
    ],
    expectedNativeEvents: [nativeEvent],
    nativeEvent,
    payload: {
      event: { status: nativeEvent.endsWith("done") ? "done" : "cancelled" },
      sessionId,
    },
    producerKey: "agent.end",
    scenarios,
  };
}

const actions: AgentStatusTraceAction[] = [
  ampAction(
    "session.start",
    "SessionStart",
    "lifecycle",
    {
      expectedEventFields: { sessionId: "amp-session-1" },
      expectedStatusAbsent: true,
    },
    { sessionId: "amp-session-1" }
  ),
  ampAction(
    "agent.start",
    "PromptSubmit",
    "processing",
    {
      expectedEventFields: { sessionId: "amp-session-1" },
      expectedStatus: "processing",
    },
    { sessionId: "amp-session-1" }
  ),
  ampAction(
    "thread.state.awaiting-approval",
    "InteractionRequested",
    "waiting",
    {
      expectedEventFields: { sessionId: "amp-session-1" },
      expectedStatus: "waiting",
    },
    { sessionId: "amp-session-1", state: "awaiting-approval" },
    "thread.state"
  ),
  ampAction(
    "thread.state.running.resolved",
    "InteractionResolved",
    "processing",
    {
      expectedEventFields: {
        interactionOutcome: "completed",
        sessionId: "amp-session-1",
      },
      expectedStatus: "processing",
    },
    { sessionId: "amp-session-1", state: "running" },
    "thread.state",
    ["accept", "resume-after-waiting"],
    ["thread.state.running.resolved", "thread.state.running"]
  ),
  ampAction(
    "thread.state.awaiting-approval",
    "InteractionRequested",
    "waiting",
    {
      expectedEventFields: { sessionId: "amp-session-1" },
      expectedStatus: "waiting",
    },
    { sessionId: "amp-session-1", state: "awaiting-approval" },
    "thread.state"
  ),
  ampAction(
    "thread.state.idle",
    "InteractionResolved",
    "processing",
    {
      expectedEventFields: {
        interactionOutcome: "completed",
        nativeState: "idle",
        sessionId: "amp-session-1",
      },
      expectedStatus: "processing",
    },
    { sessionId: "amp-session-1", state: "idle" },
    "thread.state"
  ),
  ampTerminal("agent.end.done", "TurnCompleted", "completed", "amp-session-1"),
  ampAction(
    "session.start",
    "SessionStart",
    "lifecycle",
    {
      expectedEventFields: { sessionId: "amp-session-2" },
      expectedStatusAbsent: true,
    },
    { sessionId: "amp-session-2" },
    undefined,
    ["session-replacement"]
  ),
  ampAction(
    "agent.start",
    "PromptSubmit",
    "processing",
    {
      expectedEventFields: { sessionId: "amp-session-2" },
      expectedStatus: "processing",
    },
    { sessionId: "amp-session-2" }
  ),
  ampTerminal(
    "agent.end.cancelled",
    "TurnInterrupted",
    "interrupted",
    "amp-session-2",
    ["cancel", "interrupted"]
  ),
  ampAction(
    "session.start",
    "SessionStart",
    "lifecycle",
    {
      expectedEventFields: { sessionId: "amp-session-3" },
      expectedStatusAbsent: true,
    },
    { sessionId: "amp-session-3" }
  ),
  ampAction(
    "agent.start",
    "PromptSubmit",
    "processing",
    {
      expectedEventFields: { sessionId: "amp-session-3" },
      expectedStatus: "processing",
    },
    { sessionId: "amp-session-3" }
  ),
  ampAction(
    "thread.state.awaiting-approval",
    "InteractionRequested",
    "waiting",
    {
      expectedEventFields: { sessionId: "amp-session-3" },
      expectedStatus: "waiting",
    },
    { sessionId: "amp-session-3", state: "awaiting-approval" },
    "thread.state"
  ),
  {
    ...ampAction(
      "thread.state.error",
      "error",
      "error",
      {
        expectedEventFields: {
          nativeState: "error",
          sessionId: "amp-session-3",
        },
        expectedStatus: "error",
      },
      { sessionId: "amp-session-3", state: "error" },
      "thread.state",
      ["error"],
      ["thread.state.error.resolved", "thread.state.error"]
    ),
    eventAssertions: [
      {
        expectedEvent: "InteractionResolved",
        expectedEventFields: {
          interactionOutcome: "failed",
          nativeState: "error",
          sessionId: "amp-session-3",
        },
        expectedNativeEvent: "thread.state.error.resolved",
      },
    ],
  },
];

export const AMP_PLUGIN_STATUS_TRACE = {
  actions,
  agentId: "amp",
  covers: [
    "lifecycle",
    "ready",
    "processing",
    "waiting",
    "error",
    "completed",
    "interrupted",
  ],
  createProducer: createAmpPluginProducer,
  stopAuthority: ampIntegration.runtime.stopAuthority,
} as const satisfies AgentStatusTraceFixture;
