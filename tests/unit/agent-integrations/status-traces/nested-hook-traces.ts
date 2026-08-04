import { CODEBUDDY_HOOK_EVENTS } from "@main/services/agents/integrations/codebuddy.ts";
import { COMMAND_CODE_HOOK_EVENTS } from "@main/services/agents/integrations/command-code.ts";
import { DEVIN_HOOK_EVENTS } from "@main/services/agents/integrations/devin.ts";
import { DROID_HOOK_EVENTS } from "@main/services/agents/integrations/droid.ts";
import { GEMINI_HOOK_EVENTS } from "@main/services/agents/integrations/gemini.ts";
import { GOOSE_HOOK_EVENTS } from "@main/services/agents/integrations/goose.ts";
import { OPENCLAUDE_HOOK_EVENTS } from "@main/services/agents/integrations/openclaude.ts";
import { QODERCLI_HOOK_EVENTS } from "@main/services/agents/integrations/qodercli.ts";
import { QWEN_CODE_HOOK_EVENTS } from "@main/services/agents/integrations/qwen-code.ts";
import type { NestedHookEventSpec } from "@main/services/agents/integrations/shared.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { createNestedHookCommandProducer } from "./hook-command-driver.ts";
import type {
  AgentStatusTraceAction,
  AgentStatusTraceFixture,
} from "./status-trace-types.ts";

const BASE_PAYLOAD = {
  cwd: "/repo",
  prompt: "Inspect the status pipeline",
  prompt_id: "turn-1",
  session_id: "session-1",
};

export function traceAction(
  nativeEvent: string,
  event: AgentStatusTraceAction["checkpoints"][number]["expectedEvent"],
  dimension: AgentStatusTraceAction["checkpoints"][number]["dimension"],
  expected: Omit<
    AgentStatusTraceAction["checkpoints"][number],
    "dimension" | "expectedEvent" | "expectedNativeEvent"
  >,
  payload: Record<string, unknown> = {},
  exactPayload = false
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
    expectedNativeEvents: [nativeEvent],
    nativeEvent,
    payload: exactPayload ? payload : { ...BASE_PAYLOAD, ...payload },
  };
}

export function commonTraceActions(options: {
  error?: boolean;
  errorNativeEvent?: string;
  errorPayload?: Record<string, unknown>;
  lifecycleEnd?: boolean;
  promptNativeEvent?: string;
  sessionStartNativeEvent?: string;
  sessionEndNativeEvent?: string;
  subagent?: boolean;
  subagentStartExpectedEventFields?: AgentStatusTraceAction["checkpoints"][number]["expectedEventFields"];
  subagentStartNativeEvent?: string;
  subagentStartPayload?: Record<string, unknown>;
  subagentStopExpectedEventFields?: AgentStatusTraceAction["checkpoints"][number]["expectedEventFields"];
  subagentStopNativeEvent?: string;
  subagentStopPayload?: Record<string, unknown>;
  toolCompletePayload?: Record<string, unknown>;
  toolCompleteExpectedEventFieldsAbsent?: AgentStatusTraceAction["checkpoints"][number]["expectedEventFieldsAbsent"];
  toolCompleteNativeEvent: string;
  toolStartPayload?: Record<string, unknown>;
  toolStartExpectedEventFieldsAbsent?: AgentStatusTraceAction["checkpoints"][number]["expectedEventFieldsAbsent"];
  toolStartNativeEvent: string;
  waiting?: boolean;
  /**
   * Pre/PostToolUse 上按 tool 名分发的阻塞等人工具（plan 审批等）。
   * 与 Elicitation 路径互斥选用。
   */
  interactiveToolWaiting?: {
    toolName: string;
    toolNameField?: "tool_name" | "toolName";
    toolUseIdField?: "tool_use_id" | "toolUseId";
  };
}): AgentStatusTraceAction[] {
  const actions: AgentStatusTraceAction[] = [
    traceAction(
      options.sessionStartNativeEvent ?? "SessionStart",
      "SessionStart",
      "lifecycle",
      { expectedStatusAbsent: true }
    ),
  ];
  if (options.promptNativeEvent) {
    actions.push(
      traceAction(
        options.promptNativeEvent,
        "PromptSubmit",
        "processing",
        { expectedStatus: "processing" },
        { prompt: "Inspect the status pipeline" }
      )
    );
  }
  actions.push(
    traceAction(
      options.toolStartNativeEvent,
      "ToolStart",
      "tool",
      {
        expectedStatus: "tool",
        ...(options.toolStartExpectedEventFieldsAbsent
          ? {
              expectedEventFieldsAbsent:
                options.toolStartExpectedEventFieldsAbsent,
            }
          : {}),
      },
      options.toolStartPayload ?? {
        tool_name: "Bash",
        tool_use_id: "tool-1",
      }
    ),
    traceAction(
      options.toolCompleteNativeEvent,
      "ToolComplete",
      "processing",
      {
        expectedStatus: "processing",
        ...(options.toolCompleteExpectedEventFieldsAbsent
          ? {
              expectedEventFieldsAbsent:
                options.toolCompleteExpectedEventFieldsAbsent,
            }
          : {}),
      },
      options.toolCompletePayload ?? {
        tool_name: "Bash",
        tool_use_id: "tool-1",
      }
    )
  );
  if (options.waiting) {
    actions.push(
      traceAction(
        "Elicitation",
        "InteractionRequested",
        "waiting",
        { expectedStatus: "waiting" },
        { elicitation_id: "question-1" }
      ),
      traceAction(
        "ElicitationResult",
        "InteractionResolved",
        "processing",
        { expectedStatus: "processing" },
        { action: "accept", elicitation_id: "question-1" }
      )
    );
  }
  if (options.interactiveToolWaiting) {
    const nameField =
      options.interactiveToolWaiting.toolNameField ?? "tool_name";
    const idField =
      options.interactiveToolWaiting.toolUseIdField ?? "tool_use_id";
    const planPayload = {
      [nameField]: options.interactiveToolWaiting.toolName,
      [idField]: "plan-exit-1",
    };
    actions.push(
      traceAction(
        options.toolStartNativeEvent,
        "InteractionRequested",
        "waiting",
        {
          expectedEventFields: {
            interactionId: "plan-exit-1",
            interactionKind: "permission",
            toolName: options.interactiveToolWaiting.toolName,
            toolUseId: "plan-exit-1",
          },
          expectedStatus: "waiting",
        },
        planPayload
      ),
      {
        ...traceAction(
          options.toolCompleteNativeEvent,
          "InteractionResolved",
          "processing",
          {
            expectedEventFields: {
              interactionId: "plan-exit-1",
              interactionKind: "permission",
              interactionOutcome: "completed",
              toolName: options.interactiveToolWaiting.toolName,
              toolUseId: "plan-exit-1",
            },
            expectedStatus: "processing",
          },
          planPayload
        ),
        scenarios: ["resume-after-waiting"],
      }
    );
  }
  if (options.subagent) {
    actions.push(
      traceAction(
        options.subagentStartNativeEvent ?? "SubagentStart",
        "SubagentStart",
        "subagent",
        {
          expectedStatus: "processing",
          expectedSubagentCount: 1,
          ...(options.subagentStartExpectedEventFields
            ? {
                expectedEventFields: options.subagentStartExpectedEventFields,
              }
            : {}),
        },
        options.subagentStartPayload ?? {
          agent_id: "subagent-1",
          agent_type: "Explore",
        }
      ),
      traceAction(
        options.subagentStopNativeEvent ?? "SubagentStop",
        "SubagentStop",
        "subagent",
        {
          expectedStatus: "processing",
          expectedSubagentCount: 0,
          ...(options.subagentStopExpectedEventFields
            ? {
                expectedEventFields: options.subagentStopExpectedEventFields,
              }
            : {}),
        },
        options.subagentStopPayload ?? {
          agent_id: "subagent-1",
          agent_type: "Explore",
        }
      )
    );
  }
  if (options.error) {
    actions.push(
      traceAction(
        options.errorNativeEvent ?? "StopFailure",
        "error",
        "error",
        { expectedStatus: "error" },
        options.errorPayload ?? {
          error: "upstream request failed",
          error_type: "api_error",
        }
      )
    );
  }
  if (options.lifecycleEnd) {
    actions.push(
      traceAction(
        options.sessionEndNativeEvent ?? "SessionEnd",
        "SessionEnd",
        "lifecycle",
        { expectedAbsent: true }
      )
    );
  }
  return actions;
}

function nestedTrace(
  agentId: AgentKind,
  events: readonly NestedHookEventSpec[],
  covers: AgentStatusTraceFixture["covers"],
  actions: readonly AgentStatusTraceAction[]
): AgentStatusTraceFixture {
  return {
    actions,
    agentId,
    covers,
    createProducer: () => createNestedHookCommandProducer(agentId, events),
    stopAuthority: "advisory",
  };
}

const geminiActions = commonTraceActions({
  lifecycleEnd: true,
  promptNativeEvent: "BeforeAgent",
  toolCompleteExpectedEventFieldsAbsent: ["toolUseId"],
  toolCompletePayload: {
    tool_name: "shell",
    tool_response: { output: "ok" },
  },
  toolCompleteNativeEvent: "AfterTool",
  toolStartExpectedEventFieldsAbsent: ["toolUseId"],
  toolStartPayload: {
    tool_input: { command: "pwd" },
    tool_name: "shell",
  },
  toolStartNativeEvent: "BeforeTool",
});
geminiActions.splice(-1, 0, {
  checkpoints: [],
  eventAssertions: [
    {
      expectedEvent: "Stop",
      expectedNativeEvent: "AfterAgent",
    },
  ],
  expectedNativeEvents: ["AfterAgent"],
  nativeEvent: "AfterAgent",
  nonCoveringAssertion: { expectedStatusAbsent: true },
  payload: BASE_PAYLOAD,
});

const codebuddyActions = commonTraceActions({
  error: true,
  lifecycleEnd: true,
  promptNativeEvent: "UserPromptSubmit",
  subagent: true,
  toolCompleteNativeEvent: "PostToolUse",
  toolStartNativeEvent: "PreToolUse",
  waiting: true,
});
codebuddyActions.splice(
  -2,
  0,
  traceAction(
    "Elicitation",
    "InteractionRequested",
    "waiting",
    {
      expectedEventFields: {
        interactionId: "question-cancel-1",
        interactionKind: "question",
      },
      expectedStatus: "waiting",
    },
    { elicitation_id: "question-cancel-1" }
  ),
  {
    ...traceAction(
      "ElicitationResult",
      "InteractionResolved",
      "processing",
      {
        expectedEventFields: {
          interactionId: "question-cancel-1",
          interactionKind: "question",
          interactionOutcome: "cancelled",
        },
        expectedStatus: "processing",
      },
      { action: "cancel", elicitation_id: "question-cancel-1" }
    ),
    scenarios: ["cancel"],
  }
);

export const NESTED_HOOK_STATUS_TRACES = [
  nestedTrace(
    "gemini",
    GEMINI_HOOK_EVENTS,
    ["lifecycle", "processing", "tool"],
    geminiActions
  ),
  nestedTrace(
    "droid",
    DROID_HOOK_EVENTS,
    ["lifecycle", "processing", "tool"],
    commonTraceActions({
      lifecycleEnd: true,
      promptNativeEvent: "UserPromptSubmit",
      toolCompleteNativeEvent: "PostToolUse",
      toolStartNativeEvent: "PreToolUse",
    })
  ),
  nestedTrace(
    "codebuddy",
    CODEBUDDY_HOOK_EVENTS,
    ["lifecycle", "processing", "tool", "waiting", "error", "subagent"],
    codebuddyActions
  ),
  nestedTrace(
    "qodercli",
    QODERCLI_HOOK_EVENTS,
    ["lifecycle", "processing", "tool", "waiting", "error", "subagent"],
    commonTraceActions({
      error: true,
      lifecycleEnd: true,
      promptNativeEvent: "UserPromptSubmit",
      subagent: true,
      toolCompleteNativeEvent: "PostToolUse",
      toolStartNativeEvent: "PreToolUse",
      waiting: true,
    })
  ),
  nestedTrace(
    "qwen-code",
    QWEN_CODE_HOOK_EVENTS,
    ["lifecycle", "processing", "tool", "error", "subagent"],
    commonTraceActions({
      error: true,
      lifecycleEnd: true,
      promptNativeEvent: "UserPromptSubmit",
      subagent: true,
      toolCompleteNativeEvent: "PostToolUse",
      toolStartNativeEvent: "PreToolUse",
    })
  ),
  nestedTrace(
    "openclaude",
    OPENCLAUDE_HOOK_EVENTS,
    ["lifecycle", "processing", "tool", "waiting", "error", "subagent"],
    commonTraceActions({
      error: true,
      interactiveToolWaiting: { toolName: "ExitPlanMode" },
      lifecycleEnd: true,
      promptNativeEvent: "UserPromptSubmit",
      subagent: true,
      toolCompleteNativeEvent: "PostToolUse",
      toolStartNativeEvent: "PreToolUse",
    })
  ),
  nestedTrace(
    "command-code",
    COMMAND_CODE_HOOK_EVENTS,
    ["lifecycle", "processing", "tool"],
    commonTraceActions({
      toolCompleteNativeEvent: "PostToolUse",
      toolStartNativeEvent: "PreToolUse",
    })
  ),
  nestedTrace(
    "goose",
    GOOSE_HOOK_EVENTS,
    ["lifecycle", "processing", "tool"],
    commonTraceActions({
      lifecycleEnd: true,
      promptNativeEvent: "UserPromptSubmit",
      toolCompleteExpectedEventFieldsAbsent: ["toolUseId"],
      toolCompletePayload: {
        tool_name: "developer",
        tool_output: "ok",
      },
      toolCompleteNativeEvent: "PostToolUse",
      toolStartExpectedEventFieldsAbsent: ["toolUseId"],
      toolStartPayload: {
        tool_input: { command: "pwd" },
        tool_name: "developer",
      },
      toolStartNativeEvent: "PreToolUse",
    })
  ),
  nestedTrace(
    "devin",
    DEVIN_HOOK_EVENTS,
    ["lifecycle", "processing", "tool"],
    commonTraceActions({
      lifecycleEnd: true,
      promptNativeEvent: "UserPromptSubmit",
      toolCompleteNativeEvent: "PostToolUse",
      toolStartNativeEvent: "PreToolUse",
    })
  ),
] as const satisfies readonly AgentStatusTraceFixture[];
