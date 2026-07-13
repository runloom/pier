import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
} from "./shared.ts";

const codebuddyConfigPath = () =>
  join(homedir(), ".codebuddy", "settings.json");

/**
 * CodeBuddy hook 事件 → pier 事件名。
 * CodeBuddy Code 是 Claude Code 的 fork（@tencent-ai/codebuddy-code）,
 * hook schema 与事件表与 claude.ts 完全一致（wire-identical）：同 13 个事件,
 * 无 matcher。事件名由 dist/codebuddy.js 运行时核实（PermissionRequest /
 * PermissionDenied / PostToolUseFailure / SubagentStart 均在 runtime 中存在,
 * 虽非全部列于官方 hooks.md 事件矩阵,但 fork 行为与 claude 对齐）。
 */
const CODEBUDDY_SPEC: NestedJsonIntegrationSpec = {
  agentId: "codebuddy",
  capability: "full",
  runtime: { stopAuthority: "advisory" },
  configPath: codebuddyConfigPath,
  detect: () =>
    existsSync(codebuddyConfigPath()) || commandExistsOnPath("codebuddy"),
  events: [
    { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
    { nativeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
    { nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
    { nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
    { nativeEvent: "PostToolUseFailure", pierEvent: "ToolComplete" },
    { nativeEvent: "PermissionRequest", pierEvent: "PermissionRequest" },
    { nativeEvent: "PermissionDenied", pierEvent: "processing" },
    { nativeEvent: "PreCompact", pierEvent: "processing" },
    { nativeEvent: "Stop", pierEvent: "Stop" },
    { nativeEvent: "StopFailure", pierEvent: "error" },
    { nativeEvent: "SubagentStart", pierEvent: "SubagentStart" },
    { nativeEvent: "SubagentStop", pierEvent: "SubagentStop" },
    { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
  ],
};

export const codebuddyIntegration = createNestedJsonIntegration(CODEBUDDY_SPEC);
