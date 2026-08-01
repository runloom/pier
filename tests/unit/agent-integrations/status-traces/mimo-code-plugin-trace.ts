import { mimoCodeIntegration } from "@main/services/agents/integrations/mimo-code.ts";
import { createMimoCodePluginProducer } from "./hosted-source-driver.ts";
import {
  action,
  direct,
  event,
  terminal,
} from "./remaining-hosted-trace-helpers.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceFixture,
} from "./status-trace-types.ts";

const mimoActions: AgentStatusTraceAction[] = [
  action(
    "session.created",
    "SessionStart",
    "lifecycle",
    {
      expectedEventFields: { sessionId: "mimo-main-1" },
      expectedStatusAbsent: true,
    },
    event("session.created", { info: { id: "mimo-main-1" } })
  ),
  action(
    "chat.message",
    "PromptSubmit",
    "processing",
    {
      expectedEventFields: {
        sessionId: "mimo-main-1",
        turnId: "mimo-message-1",
      },
      expectedStatus: "processing",
    },
    direct(
      "chat.message",
      { messageID: "mimo-message-1", sessionID: "mimo-main-1" },
      {
        message: { id: "mimo-message-1", role: "user" },
        parts: [{ text: "Inspect status", type: "text" }],
      }
    )
  ),
  action(
    "session.pre",
    "running",
    "processing",
    {
      expectedEventFields: { sessionId: "mimo-main-1" },
      expectedStatus: "processing",
    },
    direct("session.pre", { agentID: "main", sessionID: "mimo-main-1" })
  ),
  action(
    "tool.execute.before",
    "ToolStart",
    "tool",
    {
      expectedEventFields: {
        sessionId: "mimo-main-1",
        toolUseId: "mimo-tool-1",
      },
      expectedStatus: "tool",
    },
    direct("tool.execute.before", {
      callID: "mimo-tool-1",
      sessionID: "mimo-main-1",
      tool: "bash",
    })
  ),
  action(
    "tool.execute.after",
    "ToolComplete",
    "processing",
    {
      expectedEventFields: {
        sessionId: "mimo-main-1",
        toolUseId: "mimo-tool-1",
      },
      expectedStatus: "processing",
    },
    direct("tool.execute.after", {
      callID: "mimo-tool-1",
      sessionID: "mimo-main-1",
      tool: "bash",
    })
  ),
  action(
    "permission.asked",
    "InteractionRequested",
    "waiting",
    {
      expectedEventFields: {
        interactionId: "mimo-permission-1",
        sessionId: "mimo-main-1",
      },
      expectedStatus: "waiting",
    },
    event("permission.asked", {
      id: "mimo-permission-1",
      permission: "bash",
      sessionID: "mimo-main-1",
    })
  ),
  action(
    "permission.replied",
    "InteractionResolved",
    "processing",
    {
      expectedEventFields: {
        interactionId: "mimo-permission-1",
        interactionOutcome: "accepted",
        sessionId: "mimo-main-1",
      },
      expectedStatus: "processing",
    },
    event("permission.replied", {
      reply: "once",
      requestID: "mimo-permission-1",
      sessionID: "mimo-main-1",
    })
  ),
  terminal(
    "session.post=completed",
    "TurnCompleted",
    "completed",
    "mimo-main-1",
    direct("session.post", {
      agentID: "main",
      outcome: "completed",
      sessionID: "mimo-main-1",
    })
  ),
  action(
    "session.deleted",
    "SessionEnd",
    "lifecycle",
    { expectedAbsent: true },
    event("session.deleted", { info: { id: "mimo-main-1" } })
  ),
  action(
    "session.created",
    "SessionStart",
    "lifecycle",
    {
      expectedEventFields: { sessionId: "mimo-main-2" },
      expectedStatusAbsent: true,
    },
    event("session.created", { info: { id: "mimo-main-2" } })
  ),
  action(
    "session.pre",
    "running",
    "processing",
    {
      expectedEventFields: { sessionId: "mimo-main-2" },
      expectedStatus: "processing",
    },
    direct("session.pre", { agentID: "main", sessionID: "mimo-main-2" })
  ),
  terminal(
    "session.post=cancelled",
    "TurnInterrupted",
    "interrupted",
    "mimo-main-2",
    direct("session.post", {
      agentID: "main",
      outcome: "cancelled",
      sessionID: "mimo-main-2",
    })
  ),
  action(
    "session.created",
    "SessionStart",
    "lifecycle",
    {
      expectedEventFields: { sessionId: "mimo-main-3" },
      expectedStatusAbsent: true,
    },
    event("session.created", { info: { id: "mimo-main-3" } })
  ),
  action(
    "session.post=error",
    "error",
    "error",
    {
      expectedEventFields: { sessionId: "mimo-main-3" },
      expectedStatus: "error",
    },
    direct("session.post", {
      agentID: "main",
      outcome: "error",
      sessionID: "mimo-main-3",
    })
  ),
];

export const MIMO_CODE_STATUS_TRACE = {
  actions: mimoActions,
  agentId: "mimo-code",
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
  createProducer: createMimoCodePluginProducer,
  stopAuthority: mimoCodeIntegration.runtime.stopAuthority,
} as const satisfies AgentStatusTraceFixture;
