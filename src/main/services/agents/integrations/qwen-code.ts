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
    // QwenLM/qwen-code packages/core/src/hooks/types.ts HookEventName
    // 实锤含以下三个状态相关事件（docs/users/features/hooks.md 同步列出）。
    { nativeEvent: "PermissionRequest", pierEvent: "PermissionRequest" },
    { nativeEvent: "SubagentStart", pierEvent: "SubagentStart" },
    { nativeEvent: "SubagentStop", pierEvent: "SubagentStop" },
    { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
  ],
  // ⚠️ 同 gemini.ts 的单位陷阱：Qwen Code 是 Gemini CLI fork, hook 配置的
  // `timeout` 字段按【毫秒】解释。不覆盖此值时 shared 工厂默认写 5——
  // 即 5ms, hook 几乎必超时被杀, 整条状态链路静默失效。此处必须是毫秒值。
  timeoutSeconds: 10_000,
};

export const qwenCodeIntegration = createNestedJsonIntegration(QWEN_CODE_SPEC);
