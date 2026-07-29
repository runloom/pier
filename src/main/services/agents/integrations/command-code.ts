import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  pierHookCommandV3WithStdin,
} from "./shared.ts";

const commandCodeConfigPath = () =>
  join(homedir(), ".commandcode", "settings.json");

/**
 * Command Code hook 事件 → pier 事件名。
 * 状态证据仅覆盖 4 个事件（会话开始 +
 * 工具起止 + 回合结束）。不补 UserPromptSubmit 并非我们主动弃装——产品
 * 根本没有这个事件，官方共 4 事件（不含 UserPromptSubmit）。
 * 当前官方文档明确公共 session_id 稳定，真实工具调用都带稳定
 * tool_use_id，因此工具使用具名闭环。Stop 可要求智能体重试，保持 advisory。
 * matcher 保持 ".*" 以匹配全部工具；SessionStart/Stop 必须省略 matcher。
 */
function commandCodeCommand(
  nativeEvent: string,
  event: "SessionStart" | "ToolStart" | "ToolComplete" | "Stop"
): string {
  return pierHookCommandV3WithStdin({
    agentId: "command-code",
    event,
    nativeEvent,
  });
}

const COMMAND_CODE_SPEC: NestedJsonIntegrationSpec = {
  agentId: "command-code",
  runtime: { stopAuthority: "advisory" },
  configPath: commandCodeConfigPath,
  detect: () =>
    existsSync(commandCodeConfigPath()) || commandExistsOnPath("command-code"),
  events: [
    {
      buildCommand: () => commandCodeCommand("SessionStart", "SessionStart"),
      nativeEvent: "SessionStart",
      pierEvent: "SessionStart",
    },
    {
      buildCommand: () => commandCodeCommand("PreToolUse", "ToolStart"),
      matcher: ".*",
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    },
    {
      buildCommand: () => commandCodeCommand("PostToolUse", "ToolComplete"),
      matcher: ".*",
      nativeEvent: "PostToolUse",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: () => commandCodeCommand("Stop", "Stop"),
      nativeEvent: "Stop",
      pierEvent: "Stop",
    },
  ],
};

export const commandCodeIntegration =
  createNestedJsonIntegration(COMMAND_CODE_SPEC);
export const COMMAND_CODE_HOOK_EVENTS = COMMAND_CODE_SPEC.events;
