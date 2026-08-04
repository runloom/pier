import { claudeIntegration } from "@main/services/agents/integrations/claude.ts";
import { codexIntegration } from "@main/services/agents/integrations/codex.ts";
import { grokIntegration } from "@main/services/agents/integrations/grok.ts";
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
  terminalDimension: "completed" | "interrupted",
  fields: AgentStatusTraceCheckpoint["expectedEventFields"] = {}
): AgentStatusTraceCheckpoint[] {
  return [
    {
      dimension: "ready",
      expectedEvent: event,
      expectedEventFields: fields,
      expectedNativeEvent: nativeEvent,
      expectedStatus: "ready",
    },
    {
      dimension: terminalDimension,
      expectedEvent: event,
      expectedEventFields: fields,
      expectedNativeEvent: nativeEvent,
      expectedStatus: "ready",
    },
  ];
}

function finalLifecycleAction(): AgentStatusTraceAction {
  return traceAction("SessionEnd", "SessionEnd", "lifecycle", {
    expectedAbsent: true,
  });
}

const claudeActions = commonTraceActions({
  interactiveToolWaiting: { toolName: "ExitPlanMode" },
  promptNativeEvent: "UserPromptSubmit",
  subagent: true,
  toolCompleteNativeEvent: "PostToolUse",
  toolStartNativeEvent: "PreToolUse",
});
claudeActions.push(
  {
    ...traceAction("PreCompact", "processing", "processing", {
      expectedStatus: "processing",
    }),
    scenarios: ["compaction"],
  },
  transcriptAction(
    "claude.transcript.user_interrupt",
    jsonl({
      message: {
        content: [{ text: "[Request interrupted by user]", type: "text" }],
        role: "user",
      },
      type: "user",
    }),
    terminalCheckpoints(
      "claude.transcript.user_interrupt",
      "TurnInterrupted",
      "interrupted",
      { sessionId: "session-1" }
    ),
    ["interrupted"]
  ),
  {
    ...traceAction(
      "StopFailure",
      "error",
      "error",
      { expectedStatus: "error" },
      { error: "provider request failed" }
    ),
    scenarios: ["error"],
  },
  finalLifecycleAction()
);

const codexActions = commonTraceActions({
  promptNativeEvent: "UserPromptSubmit",
  subagent: true,
  toolCompleteNativeEvent: "PostToolUse",
  toolStartNativeEvent: "PreToolUse",
});
codexActions.push(
  {
    ...traceAction("PreCompact", "processing", "processing", {
      expectedStatus: "processing",
    }),
    scenarios: ["compaction"],
  },
  transcriptAction(
    "codex.transcript.request_user_input",
    jsonl(
      { payload: { turn_id: "turn-1" }, type: "turn_context" },
      {
        payload: {
          call_id: "question-1",
          questions: [{ id: "confirm", question: "Continue?" }],
          turn_id: "turn-1",
          type: "request_user_input",
        },
        type: "event_msg",
      }
    ),
    [
      {
        dimension: "waiting",
        expectedEvent: "InteractionRequested",
        expectedEventFields: {
          interactionId: "question-1",
          interactionKind: "question",
          sessionId: "session-1",
          turnId: "turn-1",
        },
        expectedNativeEvent: "codex.transcript.request_user_input",
        expectedStatus: "waiting",
      },
    ]
  ),
  transcriptAction(
    "codex.transcript.request_user_input.output",
    jsonl({
      payload: {
        call_id: "question-1",
        output: '{"answers":{"confirm":{"answers":["yes"]}}}',
        type: "function_call_output",
      },
      type: "response_item",
    }),
    [
      {
        dimension: "processing",
        expectedEvent: "InteractionResolved",
        expectedEventFields: {
          interactionId: "question-1",
          interactionKind: "question",
          interactionOutcome: "completed",
          sessionId: "session-1",
          turnId: "turn-1",
        },
        expectedNativeEvent: "codex.transcript.request_user_input.output",
        expectedStatus: "processing",
      },
    ],
    ["accept", "resume-after-waiting"]
  ),
  transcriptAction(
    "codex.transcript.request_permissions",
    jsonl({
      payload: {
        call_id: "permission-1",
        permissions: { file_system: { write: ["/tmp"] } },
        reason: "write",
        turn_id: "turn-1",
        type: "request_permissions",
      },
      type: "event_msg",
    }),
    [
      {
        dimension: "waiting",
        expectedEvent: "InteractionRequested",
        expectedEventFields: {
          interactionId: "permission-1",
          interactionKind: "permission",
          sessionId: "session-1",
          turnId: "turn-1",
        },
        expectedNativeEvent: "codex.transcript.request_permissions",
        expectedStatus: "waiting",
      },
    ]
  ),
  transcriptAction(
    "codex.transcript.request_permissions.output",
    jsonl({
      payload: {
        call_id: "permission-1",
        output:
          '{"permissions":{"file_system":{"write":["/tmp"]}},"scope":"turn"}',
        type: "function_call_output",
      },
      type: "response_item",
    }),
    [
      {
        dimension: "processing",
        expectedEvent: "InteractionResolved",
        expectedEventFields: {
          interactionId: "permission-1",
          interactionKind: "permission",
          interactionOutcome: "accepted",
          sessionId: "session-1",
          turnId: "turn-1",
        },
        expectedNativeEvent: "codex.transcript.request_permissions.output",
        expectedStatus: "processing",
      },
    ],
    ["accept", "resume-after-waiting"]
  ),
  transcriptAction(
    "codex.transcript.task_complete",
    jsonl({
      payload: { turn_id: "turn-1", type: "task_complete" },
      type: "event_msg",
    }),
    terminalCheckpoints(
      "codex.transcript.task_complete",
      "TurnCompleted",
      "completed",
      { sessionId: "session-1", turnId: "turn-1" }
    )
  ),
  traceAction(
    "UserPromptSubmit",
    "PromptSubmit",
    "processing",
    { expectedStatus: "processing" },
    { prompt: "Second turn", prompt_id: "turn-2" }
  ),
  transcriptAction(
    "codex.transcript.turn_aborted",
    jsonl({
      payload: {
        reason: "interrupted",
        turn_id: "turn-2",
        type: "turn_aborted",
      },
      type: "event_msg",
    }),
    terminalCheckpoints(
      "codex.transcript.turn_aborted",
      "TurnInterrupted",
      "interrupted",
      { sessionId: "session-1", turnId: "turn-2" }
    ),
    ["interrupted"]
  ),
  finalLifecycleAction()
);

function grokTurnCompletedLine(
  stopReason: "cancelled" | "end_turn",
  promptId: string
): string {
  return jsonl({
    method: "_x.ai/session/update",
    params: {
      sessionId: "session-1",
      update: {
        prompt_id: promptId,
        sessionUpdate: "turn_completed",
        stop_reason: stopReason,
      },
    },
    timestamp: 1,
  });
}

const grokActions = commonTraceActions({
  promptNativeEvent: "UserPromptSubmit",
  subagent: true,
  subagentStartPayload: {
    subagentId: "subagent-1",
    subagentType: "Explore",
  },
  subagentStopPayload: {
    subagentId: "subagent-1",
    subagentType: "Explore",
  },
  interactiveToolWaiting: {
    toolName: "exit_plan_mode",
    toolNameField: "toolName",
    toolUseIdField: "toolUseId",
  },
  toolCompletePayload: {
    toolName: "Bash",
    toolUseId: "tool-1",
  },
  toolCompleteNativeEvent: "PostToolUse",
  toolStartPayload: {
    toolName: "Bash",
    toolUseId: "tool-1",
  },
  toolStartNativeEvent: "PreToolUse",
});
grokActions.push(
  {
    ...traceAction("PreCompact", "processing", "processing", {
      expectedStatus: "processing",
    }),
    scenarios: ["compaction"],
  },
  transcriptAction(
    "grok.updates.turn_completed.end_turn",
    grokTurnCompletedLine("end_turn", "turn-1"),
    terminalCheckpoints(
      "grok.updates.turn_completed.end_turn",
      "TurnCompleted",
      "completed",
      { sessionId: "session-1" }
    )
  ),
  traceAction(
    "UserPromptSubmit",
    "PromptSubmit",
    "processing",
    { expectedStatus: "processing" },
    { prompt: "Second turn", prompt_id: "turn-2" }
  ),
  transcriptAction(
    "grok.updates.turn_completed.cancelled",
    grokTurnCompletedLine("cancelled", "turn-2"),
    terminalCheckpoints(
      "grok.updates.turn_completed.cancelled",
      "TurnInterrupted",
      "interrupted",
      { sessionId: "session-1" }
    ),
    ["interrupted"]
  ),
  {
    ...traceAction(
      "StopFailure",
      "error",
      "error",
      { expectedStatus: "error" },
      { error: "provider request failed" }
    ),
    scenarios: ["error"],
  },
  finalLifecycleAction()
);
for (let index = 0; index < grokActions.length; index++) {
  const action = grokActions[index];
  if (!(action && action.producerKey !== "transcript")) continue;
  const original = action.payload as Record<string, unknown>;
  const payload = Object.fromEntries(
    Object.entries(original).filter(
      ([key]) => key !== "prompt_id" && key !== "session_id"
    )
  );
  payload.sessionId =
    action.nativeEvent === "SubagentStop" ? "subagent-1" : "session-1";
  if (typeof original.prompt_id === "string") {
    payload.promptId = original.prompt_id;
  }
  const checkpoints = action.checkpoints.map((checkpoint) => {
    let identity: AgentStatusTraceCheckpoint["expectedEventFields"];
    if (action.nativeEvent === "SubagentStart") {
      identity = {
        agentInstanceId: "subagent-1",
        agentType: "Explore",
        parentSessionId: "session-1",
      };
    } else if (action.nativeEvent === "SubagentStop") {
      identity = {
        agentInstanceId: "subagent-1",
        agentType: "Explore",
        sessionId: "subagent-1",
      };
    } else {
      identity = {
        sessionId: "session-1",
        ...(action.nativeEvent === "PreToolUse" ||
        action.nativeEvent === "PostToolUse"
          ? { toolUseId: "tool-1" }
          : {}),
      };
    }
    return {
      ...checkpoint,
      expectedEventFields: {
        ...identity,
        ...checkpoint.expectedEventFields,
      },
    };
  });
  grokActions[index] = { ...action, checkpoints, payload };
}

export const RECONCILER_STATUS_TRACES = [
  {
    actions: claudeActions,
    agentId: "claude",
    covers: [
      "lifecycle",
      "ready",
      "processing",
      "tool",
      "waiting",
      "error",
      "interrupted",
      "subagent",
    ],
    createProducer: () => createTranscriptReconcilerProducer("claude"),
    stopAuthority: claudeIntegration.runtime.stopAuthority,
  },
  {
    actions: codexActions,
    agentId: "codex",
    covers: [
      "lifecycle",
      "ready",
      "processing",
      "tool",
      "waiting",
      "completed",
      "interrupted",
      "subagent",
    ],
    createProducer: () => createTranscriptReconcilerProducer("codex"),
    stopAuthority: codexIntegration.runtime.stopAuthority,
  },
  {
    actions: grokActions,
    agentId: "grok",
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
    createProducer: () => createTranscriptReconcilerProducer("grok"),
    stopAuthority: grokIntegration.runtime.stopAuthority,
  },
] as const satisfies readonly AgentStatusTraceFixture[];
