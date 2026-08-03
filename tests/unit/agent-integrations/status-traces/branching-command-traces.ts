import {
  antigravityIntegration,
  withPierAntigravityHooks,
} from "@main/services/agents/integrations/antigravity.ts";
import {
  augIntegration,
  buildAugManagedHookScript,
} from "@main/services/agents/integrations/aug.ts";
import { createInstalledCommandProducer } from "./installed-command-driver.ts";
import { traceAction } from "./nested-hook-traces.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceCheckpoint,
  AgentStatusTraceFixture,
} from "./status-trace-types.ts";

function antigravityCommands(): ReadonlyMap<string, string> {
  const installed = withPierAntigravityHooks({});
  for (const value of Object.values(installed)) {
    if (!(value && typeof value === "object")) continue;
    const named = value as Record<
      string,
      Array<{ command?: string }> | undefined
    >;
    const pre = named.PreInvocation?.[0]?.command;
    const stop = named.Stop?.[0]?.command;
    if (pre && stop) {
      return new Map([
        ["PreInvocation", pre],
        ["Stop", stop],
      ]);
    }
  }
  throw new Error("Antigravity 安装产物缺少命名 hook");
}

function augCommands(): ReadonlyMap<string, string> {
  const script = buildAugManagedHookScript();
  return new Map(
    ["SessionStart", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"].map(
      (nativeEvent) => [nativeEvent, script]
    )
  );
}

function augAction(
  nativeEvent: string,
  event: AgentStatusTraceCheckpoint["expectedEvent"],
  dimension: AgentStatusTraceCheckpoint["dimension"],
  expectedStatus: AgentStatusTraceCheckpoint["expectedStatus"],
  payload: Record<string, unknown> = {}
): AgentStatusTraceAction {
  let expected: Omit<
    AgentStatusTraceCheckpoint,
    "dimension" | "expectedEvent" | "expectedNativeEvent"
  >;
  if (expectedStatus) {
    expected = { expectedStatus };
  } else if (event === "SessionStart") {
    expected = { expectedStatusAbsent: true };
  } else {
    expected = { expectedAbsent: true };
  }
  const officialPayload = {
    conversation_id: "aug-session-1",
    hook_event_name: nativeEvent,
    workspace_roots: ["/repo"],
    ...payload,
  };
  expected = {
    ...expected,
    expectedEventFields: {
      sessionId: String(officialPayload.conversation_id),
    },
  };
  return traceAction(
    nativeEvent,
    event,
    dimension,
    expected,
    officialPayload,
    true
  );
}

function augTerminalAction(
  event: "TurnInterrupted",
  cause: string
): AgentStatusTraceAction {
  return {
    checkpoints: [
      {
        dimension: "ready",
        expectedEvent: event,
        expectedNativeEvent: "Stop",
        expectedStatus: "ready",
      },
      {
        dimension: "interrupted",
        expectedEvent: event,
        expectedNativeEvent: "Stop",
        expectedStatus: "ready",
      },
    ],
    expectedNativeEvents: ["Stop"],
    nativeEvent: "Stop",
    payload: {
      agent_stop_cause: cause,
      conversation_id: "aug-session-1",
      hook_event_name: "Stop",
      workspace_roots: ["/repo"],
    },
    scenarios: ["interrupted"],
  };
}

const augActions: AgentStatusTraceAction[] = [
  augAction("SessionStart", "SessionStart", "lifecycle", undefined),
  augAction("PreToolUse", "ToolStart", "tool", "tool", {
    tool_name: "bash",
    tool_input: { command: "pwd" },
  }),
  augAction("PostToolUse", "ToolComplete", "processing", "processing", {
    tool_name: "bash",
    tool_input: { command: "pwd" },
  }),
  augTerminalAction("TurnInterrupted", "interrupted"),
  {
    ...augAction("SessionStart", "SessionStart", "lifecycle", undefined, {
      conversation_id: "aug-session-2",
    }),
    checkpoints: [
      {
        dimension: "lifecycle",
        expectedEvent: "SessionStart",
        expectedEventFields: { sessionId: "aug-session-2" },
        expectedNativeEvent: "SessionStart",
        expectedStatusAbsent: true,
      },
    ],
    scenarios: ["session-replacement"],
  },
  {
    checkpoints: [],
    expectedIngest: false,
    expectedNativeEvents: ["PostToolUse"],
    nativeEvent: "PostToolUse",
    payload: {
      hook_event_name: "PostToolUse",
      conversation_id: "aug-session-1",
      tool_name: "stale-tool",
      tool_input: { path: "/tmp/stale" },
    },
    scenarios: ["late-event"],
  },
  augAction("PreToolUse", "ToolStart", "tool", "tool", {
    conversation_id: "aug-session-2",
    tool_name: "read",
    tool_input: { path: "/tmp/input" },
  }),
  {
    ...augAction("Stop", "error", "error", "error", {
      agent_stop_cause: "error",
      conversation_id: "aug-session-2",
    }),
    scenarios: ["error"],
  },
  augAction("SessionEnd", "SessionEnd", "lifecycle", undefined, {
    conversation_id: "aug-session-2",
  }),
];

const antigravityBaseActions: AgentStatusTraceAction[] = [
  traceAction(
    "PreInvocation",
    "processing",
    "processing",
    {
      expectedEventFields: { sessionId: "antigravity-session-1" },
      expectedStatus: "processing",
    },
    {
      conversationId: "antigravity-session-1",
      hook_event_name: "PreInvocation",
      invocationNum: 1,
    },
    true
  ),
  traceAction(
    "Stop.active",
    "processing",
    "processing",
    {
      expectedEventFields: {
        nativeState: "tool_running",
        sessionId: "antigravity-session-1",
      },
      expectedStatus: "processing",
    },
    {
      conversationId: "antigravity-session-1",
      fullyIdle: false,
      hook_event_name: "Stop",
      invocationNum: 2,
      terminationReason: "tool_running",
    },
    true
  ),
  {
    checkpoints: [],
    eventAssertions: [
      {
        expectedEvent: "Stop",
        expectedEventFields: {
          nativeState: "completed",
          sessionId: "antigravity-session-1",
        },
        expectedNativeEvent: "Stop.fullyIdle",
      },
    ],
    expectedNativeEvents: ["Stop.fullyIdle"],
    nativeEvent: "Stop.fullyIdle",
    nonCoveringAssertion: { expectedStatusAbsent: true },
    payload: {
      conversationId: "antigravity-session-1",
      fullyIdle: true,
      hook_event_name: "Stop",
      invocationNum: 3,
      terminationReason: "completed",
    },
    producerKey: "Stop",
  },
  {
    ...traceAction(
      "Stop.error",
      "error",
      "error",
      {
        expectedEventFields: {
          nativeState: "provider failed",
          sessionId: "antigravity-session-1",
        },
        expectedStatus: "error",
      },
      {
        conversationId: "antigravity-session-1",
        error: "provider failed",
        fullyIdle: false,
        hook_event_name: "Stop",
        invocationNum: 4,
      },
      true
    ),
    producerKey: "Stop",
    scenarios: ["error"],
  },
  {
    ...traceAction(
      "PreInvocation",
      "processing",
      "processing",
      { expectedStatus: "processing" },
      {
        conversationId: "antigravity-session-1",
        hook_event_name: "PreInvocation",
        invocationNum: 5,
      },
      true
    ),
    scenarios: ["error"],
  },
];
const antigravityActions = antigravityBaseActions.map((action) =>
  action.nativeEvent.startsWith("Stop.")
    ? { ...action, producerKey: "Stop" }
    : action
);

export const BRANCHING_COMMAND_STATUS_TRACES = [
  {
    actions: antigravityActions,
    agentId: "antigravity",
    covers: ["processing", "error"],
    createProducer: () =>
      createInstalledCommandProducer("antigravity", antigravityCommands()),
    stopAuthority: antigravityIntegration.runtime.stopAuthority,
  },
  {
    actions: augActions,
    agentId: "aug",
    covers: [
      "lifecycle",
      "ready",
      "processing",
      "tool",
      "error",
      "interrupted",
    ],
    createProducer: () => createInstalledCommandProducer("aug", augCommands()),
    stopAuthority: augIntegration.runtime.stopAuthority,
  },
] as const satisfies readonly AgentStatusTraceFixture[];
