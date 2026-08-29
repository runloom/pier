import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { CLAUDE_FAMILY_INTERACTIVE_BLOCKING_TOOLS } from "./interactive-blocking-tools.ts";
import { interactiveBlockingToolLifecycleEvents } from "./interactive-tool-lifecycle.ts";
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
    });
}

/**
 * Subagent 生命周期：载荷用**父会话** session_id + agent_id/agent_type
 * （源码 start-hook input）——sessionIdAsParent 让实例别名承担子智能体
 * 身份，并行子智能体不再在 `session:<父>` 别名上塌缩合并计数。
 */
function openClaudeSubagentCommand(
  event: "SubagentStart" | "SubagentStop",
  nativeEvent: string
): (agentId: AgentKind) => string {
  return (agentId) =>
    pierHookCommandV3WithStdin({
      actorHintFromAgentId: true,
      agentId,
      event,
      nativeEvent,
      sessionIdAsParent: true,
    });
}

/**
 * OpenClaude hook 事件 → pier 事件名。
 * 事件集合来自 OpenClaude 当前源码的 HOOK_EVENTS：
 * https://github.com/Gitlawb/openclaude/blob/main/src/entrypoints/sdk/coreTypes.ts
 * 这里只消费已核验字段，不把 Claude 专属的 sessionTitle 双写复制到 OpenClaude。
 *
 * **不提取 turnId**（2026-08-29 审计）：openclaude 的 hook input base 只有
 * session_id / transcript_path / cwd / permission_mode（+子智能体
 * agent_id/agent_type），全仓 `prompt_id` 仅出现在 PromptSuggestion
 * proto——历史配置的 `turnIdFields:["prompt_id"]` 是空提取，已移除；
 * 回合记账按无 turnId 模式（与 grok 同款）。
 *
 * PermissionRequest / Elicitation 不能保证稳定请求 ID 与完整结果 hook，
 * 因此不整类进入 waiting。waiting 仅对与 Claude 同名的阻塞工具上报：
 * EnterPlanMode / ExitPlanMode / AskUserQuestion
 * （源码：src/tools/ExitPlanModeTool、EnterPlanModeTool、AskUserQuestionTool；
 * ExitPlanMode 非 teammate 路径 require user confirmation，拒绝无 Post）。
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
    ...interactiveBlockingToolLifecycleEvents({
      actorHintFromAgentId: true,
      postToolFailureNativeStateFields: [],
      tools: CLAUDE_FAMILY_INTERACTIVE_BLOCKING_TOOLS,
    }),
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
      buildCommand: openClaudeSubagentCommand("SubagentStart", "SubagentStart"),
      nativeEvent: "SubagentStart",
      pierEvent: "SubagentStart",
    },
    {
      buildCommand: openClaudeSubagentCommand("SubagentStop", "SubagentStop"),
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
