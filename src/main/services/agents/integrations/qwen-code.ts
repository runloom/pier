import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  pierHookCommandV3WithStdin,
} from "./shared.ts";

const qwenCodeConfigPath = () => join(homedir(), ".qwen", "settings.json");

/**
 * Qwen Code hook 事件 → pier 事件名。
 * 当前官方文档逐项给出了公共、工具与子智能体字段。本集成只消费这些已证明
 * 字段，不因事件名相似而继承其他产品的载荷：
 * - Pre/Post/PostFailure 都有 tool_use_id，工具失败只结算对应工具。
 * - PermissionRequest 没有请求 ID，且没有确定的结果事件，不进入等待状态。
 * - 子智能体使用 agent_id / agent_type，session_id 只作父会话锚点。
 * - Stop 可阻止智能体结束，保持 advisory；StopFailure 才是全局错误。
 *
 * timeout 单位：command hook 为毫秒（hookRunner.ts DEFAULT_HOOK_TIMEOUT=60000ms,
 * 直接传 setTimeout；docs/users/features/hooks.md 明确写
 * "Timeout in milliseconds, default 60000"）。注意 HTTP hook 为秒（默认 600）、
 * Prompt hook 为秒（默认 30），但 pier 只装 command hook，此处值为毫秒。
 */
function qwenCommand(
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
    agentId: "qwen-code",
    // 官方文档：subagent 上下文内的**普通** hook 事件（Pre/PostToolUse 等）
    // 也附带 agent_id——全事件开 actorHintFromAgentId，让子智能体的工具
    // 事件按子会话旁路（subagent-detail-ignored），不混入主 scope 工作集
    // （2026-08-29 审计，cursor Task 泄漏同族；主上下文事件无 agent_id，
    // hint 缺席不受影响）。
    actorHintFromAgentId: true,
    ...(isSubagent
      ? {
          agentInstanceIdFields: ["agent_id"],
          agentTypeFields: ["agent_type"],
          sessionIdAsParent: true,
        }
      : {}),
    event,
    nativeEvent,
    ...(nativeEvent === "PostToolUseFailure" || nativeEvent === "StopFailure"
      ? { nativeStateFields: ["error"] }
      : {}),
  });
}

const QWEN_CODE_SPEC: NestedJsonIntegrationSpec = {
  agentId: "qwen-code",
  runtime: { stopAuthority: "advisory" },
  configPath: qwenCodeConfigPath,
  detect: () => existsSync(qwenCodeConfigPath()) || commandExistsOnPath("qwen"),
  events: [
    {
      buildCommand: () => qwenCommand("SessionStart", "SessionStart"),
      nativeEvent: "SessionStart",
      pierEvent: "SessionStart",
    },
    {
      buildCommand: () => qwenCommand("UserPromptSubmit", "PromptSubmit"),
      nativeEvent: "UserPromptSubmit",
      pierEvent: "PromptSubmit",
    },
    {
      buildCommand: () => qwenCommand("Stop", "Stop"),
      nativeEvent: "Stop",
      pierEvent: "Stop",
    },
    {
      buildCommand: () => qwenCommand("StopFailure", "error"),
      nativeEvent: "StopFailure",
      pierEvent: "error",
    },
    {
      buildCommand: () => qwenCommand("PreToolUse", "ToolStart"),
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    },
    {
      buildCommand: () => qwenCommand("PostToolUse", "ToolComplete"),
      nativeEvent: "PostToolUse",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: () => qwenCommand("PostToolUseFailure", "ToolComplete"),
      nativeEvent: "PostToolUseFailure",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: () => qwenCommand("PreCompact", "processing"),
      nativeEvent: "PreCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: () => qwenCommand("PostCompact", "processing"),
      nativeEvent: "PostCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: () => qwenCommand("SubagentStart", "SubagentStart"),
      nativeEvent: "SubagentStart",
      pierEvent: "SubagentStart",
    },
    {
      buildCommand: () => qwenCommand("SubagentStop", "SubagentStop"),
      nativeEvent: "SubagentStop",
      pierEvent: "SubagentStop",
    },
    {
      buildCommand: () => qwenCommand("SessionEnd", "SessionEnd"),
      nativeEvent: "SessionEnd",
      pierEvent: "SessionEnd",
    },
  ],
  // command hook timeout 为毫秒（源码实证）——10_000 = 10 秒。
  timeoutSeconds: 10_000,
};

export const qwenCodeIntegration = createNestedJsonIntegration(QWEN_CODE_SPEC);
export const QWEN_CODE_HOOK_EVENTS = QWEN_CODE_SPEC.events;
