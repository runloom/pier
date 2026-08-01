import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  pierHookCommandV3WithStdin,
} from "./shared.ts";

const openclaudeConfigPath = () =>
  join(homedir(), ".openclaude", "settings.json");

type StandardV3Event = Exclude<
  AgentHookEventPayloadV3["event"],
  "InteractionRequested" | "InteractionResolved"
>;

function openClaudeStandardCommand(
  event: StandardV3Event,
  nativeEvent: string
): (agentId: AgentKind) => string {
  return (agentId) =>
    pierHookCommandV3WithStdin({
      actorHintFromAgentId: true,
      agentId,
      event,
      nativeEvent,
      turnIdFields: ["prompt_id"],
    });
}

/**
 * OpenClaude hook 事件 → pier 事件名。
 * 事件集合来自 OpenClaude 当前源码的 HOOK_EVENTS；这里只消费已核验字段，
 * 不把 Claude 专属的 sessionTitle 双写复制到 OpenClaude。PermissionRequest
 * 与 Elicitation 系列不能保证稳定请求 ID 和覆盖自动应答、异常、人工允许、
 * 拒绝、取消的完整结果 hook，因此不进入 waiting。
 */
const OPENCLAUDE_SPEC: NestedJsonIntegrationSpec = {
  agentId: "openclaude",
  runtime: { stopAuthority: "advisory" },
  configPath: openclaudeConfigPath,
  detect: () =>
    existsSync(openclaudeConfigPath()) || commandExistsOnPath("openclaude"),
  events: [
    {
      buildCommand: openClaudeStandardCommand("SessionStart", "SessionStart"),
      nativeEvent: "SessionStart",
      pierEvent: "SessionStart",
    },
    {
      buildCommand: openClaudeStandardCommand(
        "PromptSubmit",
        "UserPromptSubmit"
      ),
      nativeEvent: "UserPromptSubmit",
      pierEvent: "PromptSubmit",
    },
    {
      buildCommand: openClaudeStandardCommand("ToolStart", "PreToolUse"),
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    },
    {
      buildCommand: openClaudeStandardCommand("ToolComplete", "PostToolUse"),
      nativeEvent: "PostToolUse",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: openClaudeStandardCommand(
        "ToolComplete",
        "PostToolUseFailure"
      ),
      nativeEvent: "PostToolUseFailure",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: openClaudeStandardCommand("processing", "PreCompact"),
      nativeEvent: "PreCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: openClaudeStandardCommand("processing", "PostCompact"),
      nativeEvent: "PostCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: openClaudeStandardCommand("Stop", "Stop"),
      nativeEvent: "Stop",
      pierEvent: "Stop",
    },
    {
      buildCommand: openClaudeStandardCommand("error", "StopFailure"),
      nativeEvent: "StopFailure",
      pierEvent: "error",
    },
    {
      buildCommand: openClaudeStandardCommand("SubagentStart", "SubagentStart"),
      nativeEvent: "SubagentStart",
      pierEvent: "SubagentStart",
    },
    {
      buildCommand: openClaudeStandardCommand("SubagentStop", "SubagentStop"),
      nativeEvent: "SubagentStop",
      pierEvent: "SubagentStop",
    },
    {
      buildCommand: openClaudeStandardCommand("SessionEnd", "SessionEnd"),
      nativeEvent: "SessionEnd",
      pierEvent: "SessionEnd",
    },
  ],
};

export const openclaudeIntegration =
  createNestedJsonIntegration(OPENCLAUDE_SPEC);
export const OPENCLAUDE_HOOK_EVENTS = OPENCLAUDE_SPEC.events;
