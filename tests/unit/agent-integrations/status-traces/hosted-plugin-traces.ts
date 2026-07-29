import { opencodeIntegration } from "@main/services/agents/integrations/opencode.ts";
import { createOpenCodePluginProducer } from "./opencode-plugin-driver.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceCheckpoint,
  AgentStatusTraceFixture,
  AgentStatusTraceScenario,
} from "./status-trace-types.ts";

function opencodeAction(
  nativeEvent: string,
  expectedEvent: AgentStatusTraceCheckpoint["expectedEvent"],
  dimension: AgentStatusTraceCheckpoint["dimension"],
  expected: Omit<
    AgentStatusTraceCheckpoint,
    "dimension" | "expectedEvent" | "expectedNativeEvent"
  >,
  payload: unknown,
  scenarios: readonly AgentStatusTraceScenario[] = [],
  expectedNativeEvents: readonly string[] = [nativeEvent]
): AgentStatusTraceAction {
  return {
    checkpoints: [
      {
        dimension,
        expectedEvent,
        expectedNativeEvent: nativeEvent,
        ...expected,
      },
    ],
    expectedNativeEvents,
    nativeEvent,
    payload,
    scenarios,
  };
}

const event = (
  type: string,
  properties: Record<string, unknown>
): Record<string, unknown> => ({
  event: { properties, type },
  handler: "event",
});

const opencodeActions: AgentStatusTraceAction[] = [
  opencodeAction(
    "session.created",
    "SessionStart",
    "lifecycle",
    {
      expectedEventFields: { sessionId: "main" },
      expectedStatusAbsent: true,
    },
    event("session.created", { info: { id: "main" } })
  ),
  opencodeAction(
    "chat.message",
    "PromptSubmit",
    "processing",
    {
      expectedEventFields: { sessionId: "main", turnId: "message-1" },
      expectedStatus: "processing",
    },
    {
      handler: "chat.message",
      input: { messageID: "message-1", sessionID: "main" },
      output: {
        message: { id: "message-1", role: "user" },
        parts: [{ text: "Inspect status", type: "text" }],
      },
    }
  ),
  opencodeAction(
    "tool.execute.before",
    "ToolStart",
    "tool",
    {
      expectedEventFields: { sessionId: "main", toolUseId: "tool-1" },
      expectedStatus: "tool",
    },
    {
      handler: "tool.execute.before",
      input: { callID: "tool-1", sessionID: "main", tool: "read" },
    },
    ["concurrent-tools"]
  ),
  opencodeAction(
    "tool.execute.before",
    "ToolStart",
    "tool",
    {
      expectedEventFields: { sessionId: "main", toolUseId: "tool-2" },
      expectedStatus: "tool",
    },
    {
      handler: "tool.execute.before",
      input: { callID: "tool-2", sessionID: "main", tool: "bash" },
    },
    ["concurrent-tools"]
  ),
  opencodeAction(
    "tool.execute.after",
    "ToolComplete",
    "tool",
    {
      expectedEventFields: { sessionId: "main", toolUseId: "tool-1" },
      expectedStatus: "tool",
    },
    {
      handler: "tool.execute.after",
      input: { callID: "tool-1", sessionID: "main", tool: "read" },
    },
    ["concurrent-tools"]
  ),
  opencodeAction(
    "tool.execute.after",
    "ToolComplete",
    "processing",
    {
      expectedEventFields: { sessionId: "main", toolUseId: "tool-2" },
      expectedStatus: "processing",
    },
    {
      handler: "tool.execute.after",
      input: { callID: "tool-2", sessionID: "main", tool: "bash" },
    },
    ["concurrent-tools"]
  ),
  {
    ...opencodeAction(
      "permission.asked",
      "InteractionRequested",
      "waiting",
      {
        expectedEventFields: {
          interactionId: "permission-1",
          sessionId: "main",
        },
        expectedStatus: "waiting",
      },
      [
        event("permission.asked", {
          id: "permission-1",
          permission: "read",
          sessionID: "main",
        }),
        event("question.asked", {
          id: "question-1",
          questions: [{ question: "Continue?" }],
          sessionID: "main",
        }),
      ],
      ["concurrent-interactions"],
      ["permission.asked", "question.asked"]
    ),
    eventAssertions: [
      {
        expectedEvent: "InteractionRequested",
        expectedEventFields: {
          interactionId: "question-1",
          sessionId: "main",
        },
        expectedNativeEvent: "question.asked",
      },
    ],
  },
  opencodeAction(
    "permission.replied",
    "InteractionResolved",
    "waiting",
    {
      expectedEventFields: {
        interactionId: "permission-1",
        interactionOutcome: "accepted",
        sessionId: "main",
      },
      expectedStatus: "waiting",
    },
    event("permission.replied", {
      reply: "once",
      requestID: "permission-1",
      sessionID: "main",
    }),
    ["accept", "concurrent-interactions"]
  ),
  opencodeAction(
    "question.replied",
    "InteractionResolved",
    "processing",
    {
      expectedEventFields: {
        interactionId: "question-1",
        interactionOutcome: "completed",
        sessionId: "main",
      },
      expectedStatus: "processing",
    },
    event("question.replied", {
      requestID: "question-1",
      sessionID: "main",
    }),
    ["concurrent-interactions", "resume-after-waiting"]
  ),
  opencodeAction(
    "question.asked",
    "InteractionRequested",
    "waiting",
    {
      expectedEventFields: {
        interactionId: "question-2",
        sessionId: "main",
      },
      expectedStatus: "waiting",
    },
    event("question.asked", {
      id: "question-2",
      questions: [{ question: "Delete?" }],
      sessionID: "main",
    })
  ),
  opencodeAction(
    "question.rejected",
    "InteractionResolved",
    "processing",
    {
      expectedEventFields: {
        interactionId: "question-2",
        interactionOutcome: "rejected",
        sessionId: "main",
      },
      expectedStatus: "processing",
    },
    event("question.rejected", {
      requestID: "question-2",
      sessionID: "main",
    }),
    ["reject", "resume-after-waiting"]
  ),
  opencodeAction(
    "session.status=retry",
    "running",
    "processing",
    {
      expectedEventFields: { nativeState: "retry", sessionId: "main" },
      expectedStatus: "processing",
    },
    event("session.status", {
      info: { id: "main" },
      status: { type: "retry" },
    }),
    ["auto-retry"]
  ),
  opencodeAction(
    "session.status=busy.child",
    "SubagentStart",
    "subagent",
    {
      expectedEventFields: {
        agentInstanceId: "child-1",
        parentSessionId: "main",
        sessionId: "child-1",
      },
      expectedStatus: "processing",
      expectedSubagentCount: 1,
    },
    [
      event("session.created", {
        info: { id: "child-1", parentID: "main" },
      }),
      event("session.status", {
        info: { id: "child-1" },
        status: { type: "busy" },
      }),
    ],
    ["main-subagent-interleave"]
  ),
  opencodeAction(
    "tool.execute.before",
    "ToolStart",
    "tool",
    {
      expectedEventFields: { sessionId: "main", toolUseId: "main-tool-1" },
      expectedStatus: "tool",
      expectedSubagentCount: 1,
    },
    {
      handler: "tool.execute.before",
      input: { callID: "main-tool-1", sessionID: "main", tool: "bash" },
    },
    ["main-subagent-interleave"]
  ),
  opencodeAction(
    "tool.execute.after",
    "ToolComplete",
    "processing",
    {
      expectedEventFields: { sessionId: "main", toolUseId: "main-tool-1" },
      expectedStatus: "processing",
      expectedSubagentCount: 1,
    },
    {
      handler: "tool.execute.after",
      input: { callID: "main-tool-1", sessionID: "main", tool: "bash" },
    },
    ["main-subagent-interleave"]
  ),
  opencodeAction(
    "session.status=idle.child",
    "SubagentStop",
    "subagent",
    {
      expectedEventFields: {
        agentInstanceId: "child-1",
        parentSessionId: "main",
        sessionId: "child-1",
      },
      expectedStatus: "processing",
      expectedSubagentCount: 0,
    },
    event("session.status", {
      info: { id: "child-1" },
      status: { type: "idle" },
    }),
    ["main-subagent-interleave"]
  ),
  opencodeAction(
    "session.idle",
    "Stop",
    "ready",
    { expectedEventFields: { sessionId: "main" }, expectedStatus: "ready" },
    event("session.idle", { info: { id: "main" } })
  ),
  opencodeAction(
    "session.error",
    "error",
    "error",
    { expectedEventFields: { sessionId: "main" }, expectedStatus: "error" },
    event("session.error", {
      error: { message: "network failed" },
      info: { id: "main" },
    }),
    ["error"]
  ),
  opencodeAction(
    "session.deleted",
    "SessionEnd",
    "lifecycle",
    { expectedAbsent: true },
    event("session.deleted", { info: { id: "main" } })
  ),
];

export const HOSTED_PLUGIN_STATUS_TRACES = [
  {
    actions: opencodeActions,
    agentId: "opencode",
    covers: [
      "lifecycle",
      "ready",
      "processing",
      "tool",
      "waiting",
      "error",
      "subagent",
    ],
    createProducer: createOpenCodePluginProducer,
    stopAuthority: opencodeIntegration.runtime.stopAuthority,
  },
] as const satisfies readonly AgentStatusTraceFixture[];
