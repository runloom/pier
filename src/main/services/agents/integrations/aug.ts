import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
} from "./shared.ts";

/**
 * Auggie（Augment CLI）hook 事件 → pier 事件名。
 * 依据官方文档 docs.augmentcode.com/cli/hooks：
 * - 配置路径 `~/.augment/settings.json`（用户级；workspace 级
 *   `.augment/settings.json` / `settings.local.json` 优先级更高但 Pier
 *   只管用户级全局文件，与其余集成一致）。
 * - schema 与 Claude Code 完全同构：`hooks.<Event>[].hooks[].{type:"command",
 *   command,timeout}`（matcher 为可选正则, 未用于 SessionStart/SessionEnd/
 *   Stop）——可直接复用 createNestedJsonIntegration 工厂。
 * - 官方事件（依据 augmentcode/auggie CHANGELOG 累积扩展）：SessionStart,
 *   SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, Stop 共 6 个。
 *   **翻案**：先前一版认为「文档全集仅 5 个, 无 PromptSubmit」——但 auggie
 *   CHANGELOG 明确记录 "Added PromptSubmit hooks and support for updating
 *   input from PreToolUse hooks", 早期核查错过了此项。SubagentStart/Stop
 *   在 CHANGELOG 里显示为 "PreToolUse/PostToolUse hooks now run during
 *   sub-agent sessions"——是既有事件在 sub-agent 上下文里复用, 而不是新增
 *   独立事件类型, 因此不装。
 * - timeout 单位是毫秒（非 droid/claude 家族的秒）, 默认 60000ms；这里显式
 *   写 5000（5 秒, 与其余集成的默认 5 秒告警窗口对齐, 避免用官方默认的
 *   60 秒拖慢状态反馈）。
 */
const augConfigPath = () => join(homedir(), ".augment", "settings.json");
const augHomeDir = () => join(homedir(), ".augment");

const AUG_SPEC: NestedJsonIntegrationSpec = {
  agentId: "aug",
  capability: "full",
  runtime: { stopAuthority: "advisory" },
  configPath: augConfigPath,
  detect: () =>
    existsSync(augHomeDir()) ||
    commandExistsOnPath("auggie") ||
    commandExistsOnPath("aug"),
  events: [
    { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
    { nativeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
    { matcher: ".*", nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
    { matcher: ".*", nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
    { nativeEvent: "Stop", pierEvent: "Stop" },
    { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
  ],
  // 官方 timeout 单位毫秒（非 droid/claude 家族的秒）——覆盖工厂默认的
  // "5"（会被工厂当秒写入, 在 aug 语境下变成 5ms 立即超时）。
  timeoutSeconds: 5000,
};

export const augIntegration = createNestedJsonIntegration(AUG_SPEC);
