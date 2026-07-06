import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  commandExistsOnPath,
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
} from "./shared.ts";

const qodercliConfigPath = () => join(homedir(), ".qoder", "settings.json");

/**
 * Qoder CLI hook 事件 → pier 事件名。
 * Qoder CLI（阿里 qoder.com）hook schema 与事件表与 claude.ts
 * 完全一致（wire-identical）：同 13 个事件, 无 matcher。事件名依据
 * docs.qoder.com/zh/cli/hooks 核定（SessionStart/UserPromptSubmit/
 * PreToolUse/PostToolUse/PostToolUseFailure/PermissionRequest/
 * PermissionDenied/Stop/StopFailure/SubagentStart/SubagentStop/
 * PreCompact/SessionEnd）。
 */
const QODERCLI_SPEC: NestedJsonIntegrationSpec = {
  agentId: "qodercli",
  capability: "full",
  configPath: qodercliConfigPath,
  detect: () =>
    existsSync(qodercliConfigPath()) || commandExistsOnPath("qodercli"),
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

export const qodercliIntegration = createNestedJsonIntegration(QODERCLI_SPEC);
