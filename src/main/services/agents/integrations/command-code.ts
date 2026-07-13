import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
} from "./shared.ts";

const commandCodeConfigPath = () =>
  join(homedir(), ".commandcode", "settings.json");

/**
 * Command Code hook 事件 → pier 事件名。
 * capability "coarse"：仅装 4 个事件（会话开始 +
 * 工具起止 + 回合结束）。不补 UserPromptSubmit 并非我们主动弃装——产品
 * 根本没有这个事件，官方共 4 事件（不含 UserPromptSubmit）。
 * matcher 保持 ".*" 不动；此前版本注释里 "裸 * 非法/必须用 .*" 的断言
 * 无据，已删除，仅保留实际约定的写法。
 * 补装官方真实存在的 SessionStart→SessionStart。
 */
const COMMAND_CODE_SPEC: NestedJsonIntegrationSpec = {
  agentId: "command-code",
  capability: "coarse",
  runtime: { stopAuthority: "advisory" },
  configPath: commandCodeConfigPath,
  detect: () =>
    existsSync(commandCodeConfigPath()) || commandExistsOnPath("command-code"),
  events: [
    { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
    { matcher: ".*", nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
    { matcher: ".*", nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
    { nativeEvent: "Stop", pierEvent: "Stop" },
  ],
};

export const commandCodeIntegration =
  createNestedJsonIntegration(COMMAND_CODE_SPEC);
