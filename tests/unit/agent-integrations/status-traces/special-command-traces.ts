import {
  buildClineHookScript,
  CLINE_HOOK_EVENTS,
  clineIntegration,
} from "@main/services/agents/integrations/cline.ts";
import {
  cursorIntegration,
  withPierCursorHooks,
} from "@main/services/agents/integrations/cursor.ts";
import {
  kimiIntegration,
  withPierKimiHooks,
} from "@main/services/agents/integrations/kimi.ts";
import {
  buildVibeHookBlock,
  mistralVibeIntegration,
} from "@main/services/agents/integrations/mistral-vibe.ts";
import { createInstalledCommandProducer } from "./installed-command-driver.ts";
import { commonTraceActions, traceAction } from "./nested-hook-traces.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceCheckpoint,
  AgentStatusTraceFixture,
} from "./status-trace-types.ts";

function cursorCommands(): ReadonlyMap<string, string> {
  const installed = withPierCursorHooks({});
  const hooks = installed.hooks as Record<string, Array<{ command?: string }>>;
  return new Map(
    Object.entries(hooks).flatMap(([nativeEvent, entries]) => {
      const command = entries[0]?.command;
      return command ? [[nativeEvent, command] as const] : [];
    })
  );
}

function tomlCommands(
  source: string,
  eventKey: "event" | "type"
): ReadonlyMap<string, string> {
  const commands = new Map<string, string>();
  for (const block of source.split("[[hooks]]").slice(1)) {
    const eventMatch = new RegExp(`^${eventKey} = (.+)$`, "m").exec(block);
    const commandMatch = /^command = (.+)$/m.exec(block);
    if (!(eventMatch?.[1] && commandMatch?.[1])) continue;
    commands.set(JSON.parse(eventMatch[1]), JSON.parse(commandMatch[1]));
  }
  return commands;
}

function clineCommands(): ReadonlyMap<string, string> {
  return new Map(
    CLINE_HOOK_EVENTS.map(({ fileName, pierEvent }) => [
      fileName,
      buildClineHookScript(pierEvent, fileName),
    ])
  );
}

function terminalAction(
  nativeEvent: string,
  event: "TurnCompleted" | "TurnInterrupted",
  dimension: "completed" | "interrupted",
  payload: Record<string, unknown>
): AgentStatusTraceAction {
  const checkpoints: AgentStatusTraceCheckpoint[] = [
    {
      dimension: "ready",
      expectedEvent: event,
      expectedNativeEvent: nativeEvent,
      expectedStatus: "ready",
    },
    {
      dimension,
      expectedEvent: event,
      expectedNativeEvent: nativeEvent,
      expectedStatus: "ready",
    },
  ];
  return {
    checkpoints,
    expectedNativeEvents: [nativeEvent],
    nativeEvent,
    payload,
    scenarios: dimension === "interrupted" ? ["interrupted"] : [],
  };
}

const cursorActions = commonTraceActions({
  promptNativeEvent: "beforeSubmitPrompt",
  subagent: true,
  subagentStartNativeEvent: "subagentStart",
  subagentStartPayload: {
    conversation_id: "cursor-session-1",
    parent_conversation_id: "cursor-session-1",
    subagent_id: "cursor-child-1",
    subagent_type: "Explore",
  },
  subagentStopNativeEvent: "subagentStop",
  subagentStopPayload: {
    conversation_id: "cursor-session-1",
    parent_conversation_id: "cursor-session-1",
    subagent_id: "cursor-child-1",
    subagent_type: "Explore",
  },
  sessionEndNativeEvent: "sessionEnd",
  sessionStartNativeEvent: "sessionStart",
  toolCompleteNativeEvent: "postToolUse",
  toolStartNativeEvent: "preToolUse",
});
cursorActions.push(
  terminalAction("stop", "TurnCompleted", "completed", {
    conversation_id: "cursor-session-1",
    generation_id: "turn-1",
    status: "completed",
  }),
  traceAction(
    "beforeSubmitPrompt",
    "PromptSubmit",
    "processing",
    { expectedStatus: "processing" },
    { generation_id: "turn-2", prompt: "Second turn" }
  ),
  terminalAction("stop", "TurnInterrupted", "interrupted", {
    conversation_id: "cursor-session-1",
    generation_id: "turn-2",
    status: "aborted",
  }),
  traceAction(
    "beforeSubmitPrompt",
    "PromptSubmit",
    "processing",
    { expectedStatus: "processing" },
    { generation_id: "turn-3", prompt: "Third turn" }
  ),
  {
    ...traceAction(
      "stop",
      "error",
      "error",
      { expectedStatus: "error" },
      { generation_id: "turn-3", status: "error" }
    ),
    scenarios: ["error"],
  },
  traceAction("sessionEnd", "SessionEnd", "lifecycle", {
    expectedAbsent: true,
  })
);
for (let index = 0; index < cursorActions.length; index++) {
  const action = cursorActions[index];
  if (!action) continue;
  const payload = Object.fromEntries(
    Object.entries(action.payload as Record<string, unknown>).filter(
      ([key]) => key !== "prompt_id" && key !== "session_id"
    )
  );
  payload.conversation_id ??= "cursor-session-1";
  payload.generation_id ??= "turn-1";
  const checkpoints = action.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    expectedEventFields: {
      ...checkpoint.expectedEventFields,
      ...(checkpoint.expectedEvent === "SubagentStart" ||
      checkpoint.expectedEvent === "SubagentStop"
        ? {
            agentInstanceId: "cursor-child-1",
            parentSessionId: "cursor-session-1",
          }
        : {
            sessionId: "cursor-session-1",
            turnId:
              typeof payload.generation_id === "string"
                ? payload.generation_id
                : "turn-1",
          }),
      ...(checkpoint.expectedEvent === "ToolStart" ||
      checkpoint.expectedEvent === "ToolComplete"
        ? { toolUseId: "tool-1" }
        : {}),
    },
  }));
  cursorActions[index] = { ...action, checkpoints, payload };
}

const kimiActions = commonTraceActions({
  error: true,
  lifecycleEnd: true,
  promptNativeEvent: "UserPromptSubmit",
  subagent: true,
  subagentStartExpectedEventFields: { agentType: "Explore" },
  subagentStartPayload: { agent_name: "Explore" },
  subagentStopExpectedEventFields: { agentType: "Explore" },
  subagentStopPayload: { agent_name: "Explore" },
  toolCompleteNativeEvent: "PostToolUse",
  toolStartNativeEvent: "PreToolUse",
});
kimiActions.splice(-2, 0, {
  ...traceAction("PreCompact", "processing", "processing", {
    expectedStatus: "processing",
  }),
  scenarios: ["compaction"],
});

const clineActions: AgentStatusTraceAction[] = [
  traceAction("TaskStart", "SessionStart", "lifecycle", {
    expectedEventFields: {
      agentInstanceId: "cline-agent-1",
      sessionId: "cline-task-1",
    },
    expectedStatusAbsent: true,
  }),
  traceAction("TaskResume", "running", "processing", {
    expectedEventFields: {
      agentInstanceId: "cline-agent-1",
      sessionId: "cline-task-1",
    },
    expectedStatus: "processing",
  }),
  traceAction("UserPromptSubmit", "PromptSubmit", "processing", {
    expectedEventFields: {
      agentInstanceId: "cline-agent-1",
      sessionId: "cline-task-1",
    },
    expectedStatus: "processing",
  }),
  traceAction("PreToolUse", "ToolStart", "tool", {
    expectedEventFields: {
      agentInstanceId: "cline-agent-1",
      sessionId: "cline-task-1",
      toolUseId: "cline-tool-1",
    },
    expectedStatus: "tool",
  }),
  traceAction("PostToolUse", "ToolComplete", "processing", {
    expectedEventFields: {
      agentInstanceId: "cline-agent-1",
      sessionId: "cline-task-1",
      toolUseId: "cline-tool-1",
    },
    expectedStatus: "processing",
  }),
  terminalAction("TaskComplete", "TurnCompleted", "completed", {
    agent_id: "cline-agent-1",
    taskId: "cline-task-1",
  }),
  traceAction("UserPromptSubmit", "PromptSubmit", "processing", {
    expectedStatus: "processing",
  }),
  terminalAction("TaskCancel", "TurnInterrupted", "interrupted", {
    agent_id: "cline-agent-1",
    taskId: "cline-task-1",
  }),
  traceAction("UserPromptSubmit", "PromptSubmit", "processing", {
    expectedStatus: "processing",
  }),
  {
    ...traceAction("TaskError", "error", "error", {
      expectedStatus: "error",
    }),
    scenarios: ["error"],
  },
  traceAction("SessionShutdown", "SessionEnd", "lifecycle", {
    expectedAbsent: true,
  }),
];
for (let index = 0; index < clineActions.length; index++) {
  const action = clineActions[index];
  if (!action) continue;
  const payload = {
    agent_id: "cline-agent-1",
    taskId: "cline-task-1",
    ...(action.nativeEvent === "PreToolUse" ||
    action.nativeEvent === "PostToolUse"
      ? {
          tool_call: {
            id: "cline-tool-1",
            input: { command: "pwd" },
            name: "execute_command",
          },
        }
      : {}),
  };
  const checkpoints = action.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    expectedEventFields: {
      agentInstanceId: "cline-agent-1",
      sessionId: "cline-task-1",
      ...checkpoint.expectedEventFields,
    },
  }));
  clineActions[index] = { ...action, checkpoints, payload };
}

const vibeActions: AgentStatusTraceAction[] = [
  traceAction(
    "pre_tool",
    "processing",
    "processing",
    { expectedStatus: "processing" },
    {
      hook_event_name: "pre_tool",
      session_id: "vibe-session-1",
      tool_call_id: "tool-1",
      tool_name: "bash",
    },
    true
  ),
  traceAction(
    "post_tool",
    "ToolComplete",
    "processing",
    { expectedStatus: "processing" },
    {
      hook_event_name: "post_tool",
      session_id: "vibe-session-1",
      tool_call_id: "tool-1",
      tool_name: "bash",
      tool_status: "completed",
    },
    true
  ),
  {
    checkpoints: [],
    eventAssertions: [
      {
        expectedEvent: "Stop",
        expectedEventFields: { sessionId: "vibe-session-1" },
        expectedNativeEvent: "post_agent",
      },
    ],
    expectedNativeEvents: ["post_agent"],
    nativeEvent: "post_agent",
    nonCoveringAssertion: { expectedStatusAbsent: true },
    payload: {
      hook_event_name: "post_agent",
      session_id: "vibe-session-1",
    },
  },
];
for (let index = 0; index < vibeActions.length; index++) {
  const action = vibeActions[index];
  if (!action) continue;
  const payload = Object.fromEntries(
    Object.entries(action.payload as Record<string, unknown>).filter(
      ([key]) => key !== "prompt_id"
    )
  );
  const checkpoints = action.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    expectedEventFields: {
      sessionId: "vibe-session-1",
      ...(action.nativeEvent === "post_agent" ? {} : { toolUseId: "tool-1" }),
    },
  }));
  vibeActions[index] = { ...action, checkpoints, payload };
}

export const SPECIAL_COMMAND_STATUS_TRACES = [
  {
    actions: cursorActions,
    agentId: "cursor",
    covers: [
      "lifecycle",
      "ready",
      "processing",
      "tool",
      "error",
      "completed",
      "interrupted",
      "subagent",
    ],
    createProducer: () =>
      createInstalledCommandProducer("cursor", cursorCommands()),
    stopAuthority: cursorIntegration.runtime.stopAuthority,
  },
  {
    actions: kimiActions,
    agentId: "kimi",
    covers: ["lifecycle", "processing", "tool", "error", "subagent"],
    createProducer: () =>
      createInstalledCommandProducer(
        "kimi",
        tomlCommands(withPierKimiHooks(""), "event")
      ),
    stopAuthority: kimiIntegration.runtime.stopAuthority,
  },
  {
    actions: clineActions,
    agentId: "cline",
    covers: [
      "lifecycle",
      "ready",
      "processing",
      "tool",
      "error",
      "completed",
      "interrupted",
    ],
    createProducer: () =>
      createInstalledCommandProducer("cline", clineCommands()),
    stopAuthority: clineIntegration.runtime.stopAuthority,
  },
  {
    actions: vibeActions,
    agentId: "mistral-vibe",
    covers: ["processing"],
    createProducer: () =>
      createInstalledCommandProducer(
        "mistral-vibe",
        tomlCommands(buildVibeHookBlock(), "type")
      ),
    stopAuthority: mistralVibeIntegration.runtime.stopAuthority,
  },
] as const satisfies readonly AgentStatusTraceFixture[];
