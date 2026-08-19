import {
  autohandIntegration,
  withPierAutohandHooks,
} from "@main/services/agents/integrations/autohand.ts";
import {
  copilotIntegration,
  withPierCopilotHooks,
} from "@main/services/agents/integrations/copilot.ts";
import { createInstalledCommandProducer } from "./installed-command-driver.ts";
import { commonTraceActions, traceAction } from "./nested-hook-traces.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceFixture,
} from "./status-trace-types.ts";

function copilotCommands(): ReadonlyMap<string, string> {
  const installed = withPierCopilotHooks({});
  const hooks = installed.hooks as Record<string, Array<{ bash?: string }>>;
  return new Map(
    Object.entries(hooks).flatMap(([nativeEvent, entries]) => {
      const command = entries[0]?.bash;
      return command ? [[nativeEvent, command] as const] : [];
    })
  );
}

function autohandCommands(): ReadonlyMap<string, string> {
  const installed = withPierAutohandHooks({});
  const section = installed.hooks as {
    hooks?: Array<{ command?: string; event?: string }>;
  };
  return new Map(
    (section.hooks ?? []).flatMap((entry) =>
      entry.event && entry.command
        ? [[entry.event, entry.command] as const]
        : []
    )
  );
}

const autohandActions = commonTraceActions({
  promptNativeEvent: "pre-prompt",
  sessionStartNativeEvent: "session-start",
  toolCompleteNativeEvent: "post-tool",
  toolStartNativeEvent: "pre-tool",
});
autohandActions.push(
  traceAction("stop", "Stop", "ready", { expectedStatus: "ready" }),
  traceAction(
    "session-error",
    "error",
    "error",
    { expectedStatus: "error" },
    { error: "upstream request failed" }
  ),
  traceAction("session-end", "SessionEnd", "lifecycle", {
    expectedAbsent: true,
  })
);

const copilotActions = commonTraceActions({
  error: true,
  errorNativeEvent: "errorOccurred",
  errorPayload: {
    error: { message: "fatal", name: "SystemError" },
    recoverable: false,
  },
  lifecycleEnd: true,
  promptNativeEvent: "userPromptSubmitted",
  sessionEndNativeEvent: "sessionEnd",
  sessionStartNativeEvent: "sessionStart",
  subagent: true,
  subagentStartExpectedEventFields: {
    agentType: "Explore",
    parentSessionId: "copilot-session-1",
  },
  subagentStartNativeEvent: "subagentStart",
  subagentStartPayload: {
    agentName: "Explore",
    sessionId: "copilot-session-1",
  },
  subagentStopExpectedEventFields: {
    agentInstanceId: "copilot-subagent-1",
    agentType: "Explore",
    parentSessionId: "copilot-session-1",
  },
  subagentStopNativeEvent: "subagentStop",
  subagentStopPayload: {
    agentId: "copilot-subagent-1",
    agentName: "Explore",
    sessionId: "copilot-session-1",
  },
  toolCompletePayload: { toolName: "shell", toolUseId: "tool-1" },
  toolCompleteNativeEvent: "postToolUse",
  toolStartPayload: { toolName: "shell", toolUseId: "tool-1" },
  toolStartNativeEvent: "preToolUse",
}).map((action): AgentStatusTraceAction => {
  const payload = action.payload as Record<string, unknown>;
  const official = Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => key !== "prompt_id" && key !== "session_id"
    )
  );
  const checkpoints = action.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    expectedEventFields: {
      ...checkpoint.expectedEventFields,
      ...(checkpoint.expectedEvent === "SubagentStart" ||
      checkpoint.expectedEvent === "SubagentStop"
        ? {}
        : { sessionId: "copilot-session-1" }),
      ...(checkpoint.expectedEvent === "ToolStart" ||
      checkpoint.expectedEvent === "ToolComplete"
        ? { toolUseId: "tool-1" }
        : {}),
    },
  }));
  return {
    ...action,
    checkpoints,
    payload: {
      ...official,
      sessionId: "copilot-session-1",
    },
  };
});

const copilotErrorIndex = copilotActions.findIndex(
  (action) => action.nativeEvent === "errorOccurred"
);
copilotActions.splice(copilotErrorIndex, 0, {
  checkpoints: [
    {
      dimension: "ready",
      expectedEvent: "TurnCompleted",
      expectedEventFields: { sessionId: "copilot-session-1" },
      expectedNativeEvent: "agentStop",
      expectedStatus: "ready",
    },
    {
      dimension: "completed",
      expectedEvent: "TurnCompleted",
      expectedEventFields: { sessionId: "copilot-session-1" },
      expectedNativeEvent: "agentStop",
      expectedStatus: "ready",
    },
  ],
  expectedNativeEvents: ["agentStop"],
  nativeEvent: "agentStop",
  payload: {
    sessionId: "copilot-session-1",
    stopReason: "end_turn",
  },
});

export const FLAT_COMMAND_STATUS_TRACES = [
  {
    actions: copilotActions,
    agentId: "copilot",
    covers: [
      "lifecycle",
      "ready",
      "processing",
      "tool",
      "error",
      "completed",
      "subagent",
    ],
    createProducer: () =>
      createInstalledCommandProducer("copilot", copilotCommands()),
    stopAuthority: copilotIntegration.runtime.stopAuthority,
  },
  {
    actions: autohandActions,
    agentId: "autohand",
    covers: ["lifecycle", "ready", "processing", "tool", "error"],
    createProducer: () =>
      createInstalledCommandProducer("autohand", autohandCommands()),
    stopAuthority: autohandIntegration.runtime.stopAuthority,
  },
] as const satisfies readonly AgentStatusTraceFixture[];
