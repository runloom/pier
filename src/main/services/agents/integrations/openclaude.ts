import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
} from "./shared.ts";

const openclaudeConfigPath = () =>
  join(homedir(), ".openclaude", "settings.json");

/**
 * OpenClaude hook 事件 → pier 事件名。
 * OpenClaude 是 Claude Code 的 fork，hook schema 与事件表与 claude.ts
 * 完全一致（wire-identical）：同 13 个事件，无 matcher。
 */
const OPENCLAUDE_SPEC: NestedJsonIntegrationSpec = {
  agentId: "openclaude",
  capability: "full",
  configPath: openclaudeConfigPath,
  detect: () =>
    existsSync(openclaudeConfigPath()) || commandExistsOnPath("openclaude"),
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

export const openclaudeIntegration =
  createNestedJsonIntegration(OPENCLAUDE_SPEC);
