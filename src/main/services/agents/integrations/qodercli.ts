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

const qodercliConfigPath = () => join(homedir(), ".qoder", "settings.json");

/**
 * Qoder CLI hook 事件 → pier 事件名。
 * 按当前官方 CLI hooks 文档逐项声明，不继承其他产品的字段假设：
 * - 工具事件提供 tool_use_id；PostToolUseFailure 只结算对应工具。
 * - Elicitation/ElicitationResult 都携带同一 elicitation_id，形成具名
 *   question 闭环。
 * - PermissionRequest 文档载荷未提供请求 ID；PermissionDenied 虽有
 *   tool_use_id，但只表示分类器拒绝且可请求重试，不能解除人工授权等待，
 *   均不安装。
 * - SubagentStart/Stop 提供稳定 agent_id / agent_type，session_id 是父会话锚点。
 * - Stop 可阻止智能体结束，保持 advisory；StopFailure 才是全局错误。
 */
function qoderCommand(
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
    agentId: "qodercli",
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

const QODERCLI_SPEC: NestedJsonIntegrationSpec = {
  agentId: "qodercli",
  runtime: { stopAuthority: "advisory" },
  configPath: qodercliConfigPath,
  detect: () =>
    existsSync(qodercliConfigPath()) || commandExistsOnPath("qodercli"),
  events: [
    {
      buildCommand: () => qoderCommand("SessionStart", "SessionStart"),
      nativeEvent: "SessionStart",
      pierEvent: "SessionStart",
    },
    {
      buildCommand: () => qoderCommand("UserPromptSubmit", "PromptSubmit"),
      nativeEvent: "UserPromptSubmit",
      pierEvent: "PromptSubmit",
    },
    {
      buildCommand: () => qoderCommand("PreToolUse", "ToolStart"),
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    },
    {
      buildCommand: () => qoderCommand("PostToolUse", "ToolComplete"),
      nativeEvent: "PostToolUse",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: () => qoderCommand("PostToolUseFailure", "ToolComplete"),
      nativeEvent: "PostToolUseFailure",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: () =>
        pierHookCommandV3WithStdin({
          agentId: "qodercli",
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
            agentId: "qodercli",
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
      buildCommand: () => qoderCommand("PreCompact", "processing"),
      nativeEvent: "PreCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: () => qoderCommand("PostCompact", "processing"),
      nativeEvent: "PostCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: () => qoderCommand("Stop", "Stop"),
      nativeEvent: "Stop",
      pierEvent: "Stop",
    },
    {
      buildCommand: () => qoderCommand("StopFailure", "error"),
      nativeEvent: "StopFailure",
      pierEvent: "error",
    },
    {
      buildCommand: () => qoderCommand("SubagentStart", "SubagentStart"),
      nativeEvent: "SubagentStart",
      pierEvent: "SubagentStart",
    },
    {
      buildCommand: () => qoderCommand("SubagentStop", "SubagentStop"),
      nativeEvent: "SubagentStop",
      pierEvent: "SubagentStop",
    },
    {
      buildCommand: () => qoderCommand("SessionEnd", "SessionEnd"),
      nativeEvent: "SessionEnd",
      pierEvent: "SessionEnd",
    },
  ],
};

export const qodercliIntegration = createNestedJsonIntegration(QODERCLI_SPEC);
export const QODERCLI_HOOK_EVENTS = QODERCLI_SPEC.events;
