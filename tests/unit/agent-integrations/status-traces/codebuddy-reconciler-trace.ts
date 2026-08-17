import { codebuddyIntegration } from "@main/services/agents/integrations/codebuddy.ts";
import { commonTraceActions, traceAction } from "./nested-hook-traces.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceCheckpoint,
  AgentStatusTraceFixture,
} from "./status-trace-types.ts";
import {
  createTranscriptReconcilerProducer,
  jsonl,
  transcriptAction,
} from "./transcript-reconciler-driver.ts";

function terminalCheckpoints(
  nativeEvent: string,
  event: "TurnCompleted" | "TurnInterrupted",
  terminalDimension: "completed" | "interrupted"
): AgentStatusTraceCheckpoint[] {
  return [
    {
      dimension: "ready",
      expectedEvent: event,
      expectedEventFields: { sessionId: "session-1" },
      expectedNativeEvent: nativeEvent,
      expectedStatus: "ready",
    },
    {
      dimension: terminalDimension,
      expectedEvent: event,
      expectedEventFields: { sessionId: "session-1" },
      expectedNativeEvent: nativeEvent,
      expectedStatus: "ready",
    },
  ];
}

const codebuddyReconcilerActions: AgentStatusTraceAction[] = [
  ...commonTraceActions({
    promptNativeEvent: "UserPromptSubmit",
    toolCompleteNativeEvent: "PostToolUse",
    toolStartNativeEvent: "PreToolUse",
  }),
  transcriptAction(
    "codebuddy.transcript.assistant_completed",
    jsonl({
      role: "assistant",
      status: "completed",
      type: "message",
    }),
    terminalCheckpoints(
      "codebuddy.transcript.assistant_completed",
      "TurnCompleted",
      "completed"
    )
  ),
  traceAction("UserPromptSubmit", "PromptSubmit", "processing", {
    expectedStatus: "processing",
  }),
  transcriptAction(
    "codebuddy.transcript.user_interrupt",
    jsonl({
      message: {
        content: [{ text: "[Request interrupted by user]", type: "text" }],
        role: "user",
      },
      type: "user",
    }),
    terminalCheckpoints(
      "codebuddy.transcript.user_interrupt",
      "TurnInterrupted",
      "interrupted"
    ),
    ["interrupted"]
  ),
  traceAction("SessionEnd", "SessionEnd", "lifecycle", {
    expectedAbsent: true,
  }),
];

export const CODEBUDDY_RECONCILER_STATUS_TRACE = {
  actions: codebuddyReconcilerActions,
  agentId: "codebuddy",
  covers: [
    "lifecycle",
    "ready",
    "processing",
    "tool",
    "completed",
    "interrupted",
  ],
  createProducer: () => createTranscriptReconcilerProducer("codebuddy"),
  stopAuthority: codebuddyIntegration.runtime.stopAuthority,
} as const satisfies AgentStatusTraceFixture;
