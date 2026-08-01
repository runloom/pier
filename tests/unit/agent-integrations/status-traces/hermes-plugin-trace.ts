import { hermesIntegration } from "@main/services/agents/integrations/hermes.ts";
import { createHermesPluginProducer } from "./hosted-source-driver.ts";
import { action, terminal } from "./remaining-hosted-trace-helpers.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceCheckpoint,
  AgentStatusTraceFixture,
} from "./status-trace-types.ts";

function hermes(
  hook: string,
  nativeEvent: string,
  eventName: AgentStatusTraceCheckpoint["expectedEvent"],
  dimension: AgentStatusTraceCheckpoint["dimension"],
  expected: Omit<
    AgentStatusTraceCheckpoint,
    "dimension" | "expectedEvent" | "expectedNativeEvent"
  >,
  kwargs: Record<string, unknown>
): AgentStatusTraceAction {
  return action(nativeEvent, eventName, dimension, expected, { hook, kwargs });
}

const hermesActions: AgentStatusTraceAction[] = [
  hermes(
    "on_session_start",
    "on_session_start",
    "SessionStart",
    "lifecycle",
    {
      expectedEventFields: { sessionId: "hermes-main-1" },
      expectedStatusAbsent: true,
    },
    { session_id: "hermes-main-1" }
  ),
  hermes(
    "pre_llm_call",
    "pre_llm_call",
    "PromptSubmit",
    "processing",
    {
      expectedEventFields: {
        sessionId: "hermes-main-1",
        turnId: "hermes-turn-1",
      },
      expectedStatus: "processing",
    },
    {
      session_id: "hermes-main-1",
      turn_id: "hermes-turn-1",
      user_message: "Inspect status",
    }
  ),
  hermes(
    "pre_tool_call",
    "pre_tool_call",
    "ToolStart",
    "tool",
    {
      expectedEventFields: {
        sessionId: "hermes-main-1",
        toolUseId: "hermes-tool-1",
      },
      expectedStatus: "tool",
    },
    {
      session_id: "hermes-main-1",
      tool_call_id: "hermes-tool-1",
      tool_name: "terminal",
      turn_id: "hermes-turn-1",
    }
  ),
  hermes(
    "post_tool_call",
    "post_tool_call",
    "ToolComplete",
    "processing",
    {
      expectedEventFields: {
        nativeState: "ok",
        sessionId: "hermes-main-1",
        toolUseId: "hermes-tool-1",
      },
      expectedStatus: "processing",
    },
    {
      session_id: "hermes-main-1",
      status: "ok",
      tool_call_id: "hermes-tool-1",
      tool_name: "terminal",
      turn_id: "hermes-turn-1",
    }
  ),
  hermes(
    "pre_tool_call",
    "pre_tool_call.clarify",
    "InteractionRequested",
    "waiting",
    {
      expectedEventFields: {
        interactionId: "hermes-question-1",
        interactionKind: "question",
        sessionId: "hermes-main-1",
      },
      expectedStatus: "waiting",
    },
    {
      session_id: "hermes-main-1",
      tool_call_id: "hermes-question-1",
      tool_name: "clarify",
    }
  ),
  hermes(
    "post_tool_call",
    "post_tool_call.clarify",
    "InteractionResolved",
    "processing",
    {
      expectedEventFields: {
        interactionId: "hermes-question-1",
        interactionOutcome: "completed",
        sessionId: "hermes-main-1",
      },
      expectedStatus: "processing",
    },
    {
      session_id: "hermes-main-1",
      status: "ok",
      tool_call_id: "hermes-question-1",
      tool_name: "clarify",
    }
  ),
  hermes(
    "pre_approval_request",
    "pre_approval_request",
    "InteractionRequested",
    "waiting",
    {
      expectedEventFields: {
        interactionId: "hermes-approval-1",
        interactionKind: "permission",
        sessionId: "hermes-main-1",
      },
      expectedStatus: "waiting",
    },
    {
      pattern_key: "hermes-approval-1",
      session_key: "hermes-main-1",
    }
  ),
  hermes(
    "post_approval_response",
    "post_approval_response",
    "InteractionResolved",
    "processing",
    {
      expectedEventFields: {
        interactionId: "hermes-approval-1",
        interactionOutcome: "rejected",
        sessionId: "hermes-main-1",
      },
      expectedStatus: "processing",
    },
    {
      choice: "deny",
      pattern_key: "hermes-approval-1",
      session_key: "hermes-main-1",
    }
  ),
  hermes(
    "subagent_start",
    "subagent_start",
    "SubagentStart",
    "subagent",
    {
      expectedEventFields: {
        agentInstanceId: "hermes-child-1",
        agentType: "researcher",
        parentSessionId: "hermes-main-1",
        sessionId: "hermes-child-1",
      },
      expectedStatus: "processing",
      expectedSubagentCount: 1,
    },
    {
      child_role: "researcher",
      child_session_id: "hermes-child-1",
      parent_session_id: "hermes-main-1",
      parent_turn_id: "hermes-turn-1",
    }
  ),
  hermes(
    "subagent_stop",
    "subagent_stop",
    "SubagentStop",
    "subagent",
    {
      expectedEventFields: {
        agentInstanceId: "hermes-child-1",
        agentType: "researcher",
        parentSessionId: "hermes-main-1",
        sessionId: "hermes-child-1",
      },
      expectedStatus: "processing",
      expectedSubagentCount: 0,
    },
    {
      child_role: "researcher",
      child_session_id: "hermes-child-1",
      child_status: "completed",
      parent_session_id: "hermes-main-1",
      parent_turn_id: "hermes-turn-1",
    }
  ),
  terminal(
    "on_session_end.completed",
    "TurnCompleted",
    "completed",
    "hermes-main-1",
    {
      hook: "on_session_end",
      kwargs: {
        completed: true,
        failed: false,
        interrupted: false,
        session_id: "hermes-main-1",
        turn_id: "hermes-turn-1",
      },
    }
  ),
  hermes(
    "on_session_finalize",
    "on_session_finalize",
    "SessionEnd",
    "lifecycle",
    { expectedAbsent: true },
    { session_id: "hermes-main-1" }
  ),
  hermes(
    "on_session_reset",
    "on_session_reset",
    "SessionStart",
    "lifecycle",
    {
      expectedEventFields: { sessionId: "hermes-main-2" },
      expectedStatusAbsent: true,
    },
    { session_id: "hermes-main-2" }
  ),
  hermes(
    "pre_llm_call",
    "pre_llm_call",
    "PromptSubmit",
    "processing",
    {
      expectedEventFields: { sessionId: "hermes-main-2" },
      expectedStatus: "processing",
    },
    { session_id: "hermes-main-2", user_message: "Interrupt" }
  ),
  terminal(
    "on_session_end.interrupted",
    "TurnInterrupted",
    "interrupted",
    "hermes-main-2",
    {
      hook: "on_session_end",
      kwargs: {
        completed: false,
        failed: false,
        interrupted: true,
        session_id: "hermes-main-2",
      },
    }
  ),
  hermes(
    "on_session_reset",
    "on_session_reset",
    "SessionStart",
    "lifecycle",
    {
      expectedEventFields: { sessionId: "hermes-main-3" },
      expectedStatusAbsent: true,
    },
    { session_id: "hermes-main-3" }
  ),
  hermes(
    "on_session_end",
    "on_session_end.failed",
    "error",
    "error",
    {
      expectedEventFields: { sessionId: "hermes-main-3" },
      expectedStatus: "error",
    },
    {
      failed: true,
      interrupted: false,
      session_id: "hermes-main-3",
    }
  ),
];

export const HERMES_STATUS_TRACE = {
  actions: hermesActions,
  agentId: "hermes",
  covers: [
    "lifecycle",
    "ready",
    "processing",
    "tool",
    "waiting",
    "error",
    "completed",
    "interrupted",
    "subagent",
  ],
  createProducer: createHermesPluginProducer,
  stopAuthority: hermesIntegration.runtime.stopAuthority,
} as const satisfies AgentStatusTraceFixture;
