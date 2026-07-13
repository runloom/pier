import { homedir } from "node:os";
import { join } from "node:path";
import {
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  transformJsonConfig,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "./shared.ts";

/**
 * Claude Code hook 事件 → pier 事件名。
 * 依据官方 hooks reference（code.claude.com/docs/en/hooks）：
 * - 权限等待用专用 PermissionRequest 事件；不装 Notification（它还
 *   覆盖 idle_prompt / auth_success 等与状态无关的通知）。
 * - StopFailure = 回合因 API 错误终止 → pier "error" → tab failed。
 * - PostToolUseFailure = 单个工具失败, 回合仍在继续 → 视为 ToolComplete
 *   （不闪 error, error 态只留给回合级失败）。
 * - PermissionDenied：拒绝授权后 turn 继续——不装则 waiting 卡到 TTL。
 * - PreCompact：长压缩期间无其他 hook, 不装则被 30min TTL 误衰减。
 */
const CLAUDE_SPEC: NestedJsonIntegrationSpec = {
  agentId: "claude",
  capability: "full",
  runtime: { stopAuthority: "advisory" },
  configPath: () => join(homedir(), ".claude", "settings.json"),
  // claude 为旗舰集成：无条件安装（配置不存在则创建）, 保持既有行为。
  detect: () => true,
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

export const claudeIntegration = createNestedJsonIntegration(CLAUDE_SPEC);

/** 兼容导出（既有测试/调用方使用；语义与工厂一致）。 */
export function withPierClaudeHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withPierNestedHooks(settings, CLAUDE_SPEC);
}

export function withoutPierClaudeHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return withoutPierNestedHooks(settings);
}

export async function installClaudeHooks(
  settingsPath: string = CLAUDE_SPEC.configPath()
): Promise<void> {
  // 先剔全部 pier 条目再按当前 spec 装, 与工厂 createNestedJsonIntegration
  // 一致——覆盖「上一版 spec 装过但本版已移出」的遗留清理。
  await transformJsonConfig(
    settingsPath,
    (s) => withPierClaudeHooks(withoutPierClaudeHooks(s)),
    "claude"
  );
}

export async function uninstallClaudeHooks(
  settingsPath: string = CLAUDE_SPEC.configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withoutPierClaudeHooks, "claude");
}
