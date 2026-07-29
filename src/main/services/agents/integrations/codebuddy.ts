import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  pierHookCommandV3WithStdin,
  pierHookCommandV3WithStdinOutcomeDispatch,
} from "./shared.ts";

const codebuddyConfigPath = () =>
  join(homedir(), ".codebuddy", "settings.json");

/**
 * CodeBuddy hook 事件 → pier 事件名。
 * 官方 command hook 支持完整事件族；prompt hook 只支持三个事件的版本限制
 * 不适用于这里安装的 command hook。只声明能正确投影状态的事件：
 * - 工具事件使用当前发行版明确提供的 tool_use_id，失败只结算工具。
 * - 固定 2.122.0 dist/codebuddy.js
 *   (SHA-256 942a6ce7353788390f19c69554ee0a62c8c595434bdc23ec22b68ab03c88d25d)
 *   证明 Elicitation/ElicitationResult 都携带同一 elicitation_id，可组成
 *   question 闭环。
 * - PermissionRequest 虽可携带 tool_use_id，但 PermissionDenied 只在自动模式
 *   分类器拒绝时触发，不能覆盖人工授权的接受/拒绝结果，仍无确定结果闭环，
 *   因此二者均不安装。
 * - 子智能体使用 agent_id / agent_type，session_id 只作父会话锚点。
 * - Stop 可阻止智能体结束，保持 advisory；StopFailure 才是全局错误。
 */
function codebuddyCommand(
  nativeEvent: string,
  event:
    | "SessionStart"
    | "PromptSubmit"
    | "ToolStart"
    | "ToolComplete"
    | "processing"
    | "Stop"
    | "error"
    | "SubagentStart"
    | "SubagentStop"
    | "SessionEnd"
): string {
  const isSubagent =
    nativeEvent === "SubagentStart" || nativeEvent === "SubagentStop";
  return pierHookCommandV3WithStdin({
    agentId: "codebuddy",
    ...(isSubagent
      ? {
          actorHintFromAgentId: true,
          agentInstanceIdFields: ["agent_id"],
          agentTypeFields: ["agent_type"],
          sessionIdAsParent: true,
        }
      : {}),
    event,
    nativeEvent,
    ...(nativeEvent === "PostToolUseFailure" || nativeEvent === "StopFailure"
      ? { nativeStateFields: ["error_type", "error"] }
      : {}),
  });
}

const CODEBUDDY_SPEC: NestedJsonIntegrationSpec = {
  agentId: "codebuddy",
  runtime: { stopAuthority: "advisory" },
  configPath: codebuddyConfigPath,
  detect: () =>
    existsSync(codebuddyConfigPath()) || commandExistsOnPath("codebuddy"),
  events: [
    {
      buildCommand: () => codebuddyCommand("SessionStart", "SessionStart"),
      nativeEvent: "SessionStart",
      pierEvent: "SessionStart",
    },
    {
      buildCommand: () => codebuddyCommand("UserPromptSubmit", "PromptSubmit"),
      nativeEvent: "UserPromptSubmit",
      pierEvent: "PromptSubmit",
    },
    {
      buildCommand: () => codebuddyCommand("PreToolUse", "ToolStart"),
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    },
    {
      buildCommand: () => codebuddyCommand("PostToolUse", "ToolComplete"),
      nativeEvent: "PostToolUse",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: () =>
        codebuddyCommand("PostToolUseFailure", "ToolComplete"),
      nativeEvent: "PostToolUseFailure",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: () =>
        pierHookCommandV3WithStdin({
          agentId: "codebuddy",
          event: "InteractionRequested",
          interactionIdFields: ["elicitation_id"],
          interactionKind: "question",
          nativeEvent: "Elicitation",
        }),
      nativeEvent: "Elicitation",
      pierEvent: "InteractionRequested",
    },
    {
      buildCommand: () =>
        pierHookCommandV3WithStdinOutcomeDispatch(
          {
            agentId: "codebuddy",
            event: "InteractionResolved",
            interactionIdFields: ["elicitation_id"],
            interactionKind: "question",
            nativeEvent: "ElicitationResult",
            nativeStateFields: ["action"],
          },
          [
            { interactionOutcome: "accepted", nativeValue: "accept" },
            { interactionOutcome: "rejected", nativeValue: "decline" },
            { interactionOutcome: "cancelled", nativeValue: "cancel" },
          ]
        ),
      nativeEvent: "ElicitationResult",
      pierEvent: "InteractionResolved",
    },
    {
      buildCommand: () => codebuddyCommand("PreCompact", "processing"),
      nativeEvent: "PreCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: () => codebuddyCommand("PostCompact", "processing"),
      nativeEvent: "PostCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: () => codebuddyCommand("Stop", "Stop"),
      nativeEvent: "Stop",
      pierEvent: "Stop",
    },
    {
      buildCommand: () => codebuddyCommand("StopFailure", "error"),
      nativeEvent: "StopFailure",
      pierEvent: "error",
    },
    {
      buildCommand: () => codebuddyCommand("SubagentStart", "SubagentStart"),
      nativeEvent: "SubagentStart",
      pierEvent: "SubagentStart",
    },
    {
      buildCommand: () => codebuddyCommand("SubagentStop", "SubagentStop"),
      nativeEvent: "SubagentStop",
      pierEvent: "SubagentStop",
    },
    {
      buildCommand: () => codebuddyCommand("SessionEnd", "SessionEnd"),
      nativeEvent: "SessionEnd",
      pierEvent: "SessionEnd",
    },
  ],
};

export const codebuddyIntegration = createNestedJsonIntegration(CODEBUDDY_SPEC);
export const CODEBUDDY_HOOK_EVENTS = CODEBUDDY_SPEC.events;
