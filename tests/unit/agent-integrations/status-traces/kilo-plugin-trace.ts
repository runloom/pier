import { kiloIntegration } from "@main/services/agents/integrations/kilo.ts";
import { createKiloPluginProducer } from "./hosted-source-driver.ts";
import { action, direct, event } from "./remaining-hosted-trace-helpers.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceFixture,
} from "./status-trace-types.ts";

const kiloActions: AgentStatusTraceAction[] = [
  action(
    "session.created",
    "SessionStart",
    "lifecycle",
    {
      expectedEventFields: { sessionId: "kilo-main-1" },
      expectedStatusAbsent: true,
    },
    event("session.created", { info: { id: "kilo-main-1" } })
  ),
  action(
    "chat.message",
    "PromptSubmit",
    "processing",
    {
      expectedEventFields: {
        sessionId: "kilo-main-1",
        turnId: "kilo-message-1",
      },
      expectedStatus: "processing",
    },
    direct(
      "chat.message",
      { messageID: "kilo-message-1", sessionID: "kilo-main-1" },
      {
        message: { id: "kilo-message-1", role: "user" },
        parts: [{ text: "Inspect status", type: "text" }],
      }
    )
  ),
  action(
    "tool.execute.before",
    "ToolStart",
    "tool",
    {
      expectedEventFields: {
        sessionId: "kilo-main-1",
        toolUseId: "kilo-tool-1",
      },
      expectedStatus: "tool",
    },
    direct("tool.execute.before", {
      callID: "kilo-tool-1",
      sessionID: "kilo-main-1",
      tool: "bash",
    })
  ),
  action(
    "tool.execute.after",
    "ToolComplete",
    "processing",
    {
      expectedEventFields: {
        sessionId: "kilo-main-1",
        toolUseId: "kilo-tool-1",
      },
      expectedStatus: "processing",
    },
    direct("tool.execute.after", {
      callID: "kilo-tool-1",
      sessionID: "kilo-main-1",
      tool: "bash",
    })
  ),
  action(
    "permission.asked",
    "InteractionRequested",
    "waiting",
    {
      expectedEventFields: {
        interactionId: "kilo-permission-1",
        sessionId: "kilo-main-1",
      },
      expectedStatus: "waiting",
    },
    event("permission.asked", {
      id: "kilo-permission-1",
      permission: "bash",
      sessionID: "kilo-main-1",
    })
  ),
  action(
    "permission.replied",
    "InteractionResolved",
    "processing",
    {
      expectedEventFields: {
        interactionId: "kilo-permission-1",
        interactionOutcome: "accepted",
        sessionId: "kilo-main-1",
      },
      expectedStatus: "processing",
    },
    event("permission.replied", {
      reply: "once",
      requestID: "kilo-permission-1",
      sessionID: "kilo-main-1",
    })
  ),
  action(
    "session.status=busy.child",
    "SubagentStart",
    "subagent",
    {
      expectedEventFields: {
        agentInstanceId: "kilo-child-1",
        parentSessionId: "kilo-main-1",
        sessionId: "kilo-child-1",
      },
      expectedStatus: "processing",
      expectedSubagentCount: 1,
    },
    [
      event("session.created", {
        info: { id: "kilo-child-1", parentID: "kilo-main-1" },
      }),
      event("session.status", {
        sessionID: "kilo-child-1",
        status: { type: "busy" },
      }),
    ]
  ),
  action(
    "session.status=idle.child",
    "SubagentStop",
    "subagent",
    {
      expectedEventFields: {
        agentInstanceId: "kilo-child-1",
        parentSessionId: "kilo-main-1",
        sessionId: "kilo-child-1",
      },
      expectedStatus: "processing",
      expectedSubagentCount: 0,
    },
    event("session.status", {
      sessionID: "kilo-child-1",
      status: { type: "idle" },
    })
  ),
  // idle 是 advisory 候选（2026-08-29 降级对齐 opencode）：不产生 ready
  // 覆盖，状态进入候选完成（无具体 status）。
  {
    checkpoints: [],
    eventAssertions: [
      {
        expectedEvent: "Stop",
        expectedEventFields: { sessionId: "kilo-main-1" },
        expectedNativeEvent: "session.idle",
      },
    ],
    expectedNativeEvents: ["session.idle"],
    nativeEvent: "session.idle",
    nonCoveringAssertion: { expectedStatusAbsent: true },
    payload: event("session.idle", { info: { id: "kilo-main-1" } }),
  },
  action(
    "session.deleted",
    "SessionEnd",
    "lifecycle",
    { expectedAbsent: true },
    event("session.deleted", { info: { id: "kilo-main-1" } })
  ),
  action(
    "session.created",
    "SessionStart",
    "lifecycle",
    {
      expectedEventFields: { sessionId: "kilo-main-2" },
      expectedStatusAbsent: true,
    },
    event("session.created", { info: { id: "kilo-main-2" } })
  ),
  action(
    "session.error",
    "error",
    "error",
    {
      expectedEventFields: { sessionId: "kilo-main-2" },
      expectedStatus: "error",
    },
    event("session.error", {
      error: { message: "provider failed" },
      info: { id: "kilo-main-2" },
    })
  ),
];

export const KILO_STATUS_TRACE = {
  actions: kiloActions,
  agentId: "kilo",
  covers: ["lifecycle", "processing", "tool", "waiting", "error", "subagent"],
  createProducer: createKiloPluginProducer,
  stopAuthority: kiloIntegration.runtime.stopAuthority,
} as const satisfies AgentStatusTraceFixture;
