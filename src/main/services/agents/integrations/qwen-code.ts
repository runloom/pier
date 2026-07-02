import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
} from "./shared.ts";

const qwenCodeConfigPath = () => join(homedir(), ".qwen", "settings.json");

/**
 * Qwen Code hook 事件 → pier 事件名。
 * 官方 1314 行 hooks 文档 grep 零命中 "Error"——真实事件名是
 * "StopFailure"（loomdesk 参考实现把这个名字搞反了，此前版本沿用了
 * loomdesk 的错误名，现已改正）→ pier "error"。
 * 补装 UserPromptSubmit→PromptSubmit（官方文档真实存在的事件，此前版本
 * 遗漏）。
 * 工具事件不写 matcher（官方文档未要求）。
 */
const QWEN_CODE_SPEC: NestedJsonIntegrationSpec = {
  agentId: "qwen-code",
  capability: "full",
  configPath: qwenCodeConfigPath,
  detect: () => existsSync(qwenCodeConfigPath()) || commandExistsOnPath("qwen"),
  events: [
    { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
    { nativeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
    { nativeEvent: "Stop", pierEvent: "Stop" },
    { nativeEvent: "StopFailure", pierEvent: "error" },
    { nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
    { nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
    { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
  ],
};

export const qwenCodeIntegration = createNestedJsonIntegration(QWEN_CODE_SPEC);
