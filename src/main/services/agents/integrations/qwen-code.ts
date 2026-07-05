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
 * 源码实证：QwenLM/qwen-code packages/core/src/hooks/types.ts HookEventName
 * 枚举含 19 个事件（Claude 系事件名体系）；docs/users/features/hooks.md 同步
 * 列出。此处安装其中 14 个与 pier 状态机相关的事件。
 *
 * timeout 单位：command hook 为毫秒（hookRunner.ts DEFAULT_HOOK_TIMEOUT=60000ms,
 * 直接传 setTimeout；docs/users/features/hooks.md 明确写
 * "Timeout in milliseconds, default 60000"）。注意 HTTP hook 为秒（默认 600）、
 * Prompt hook 为秒（默认 30），但 pier 只装 command hook，此处值为毫秒。
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
    { nativeEvent: "PostToolUseFailure", pierEvent: "ToolComplete" },
    { nativeEvent: "PermissionRequest", pierEvent: "PermissionRequest" },
    { nativeEvent: "PermissionDenied", pierEvent: "processing" },
    { nativeEvent: "PreCompact", pierEvent: "processing" },
    { nativeEvent: "PostCompact", pierEvent: "processing" },
    { nativeEvent: "SubagentStart", pierEvent: "SubagentStart" },
    { nativeEvent: "SubagentStop", pierEvent: "SubagentStop" },
    { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
  ],
  // command hook timeout 为毫秒（源码实证）——10_000 = 10 秒。
  timeoutSeconds: 10_000,
};

export const qwenCodeIntegration = createNestedJsonIntegration(QWEN_CODE_SPEC);
