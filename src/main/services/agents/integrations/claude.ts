import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent-session.ts";
import {
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  pierClaudeUserPromptSubmitCommandV3,
  pierHookCommandV3WithStdin,
  preflightPierNestedHooksInstall,
  transformJsonConfig,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "./shared.ts";

type StandardV3Event = Exclude<
  AgentHookEventPayloadV3["event"],
  "InteractionRequested" | "InteractionResolved"
>;

function claudeStandardCommand(
  event: StandardV3Event,
  nativeEvent: string
): (agentId: AgentKind) => string {
  return (agentId) =>
    pierHookCommandV3WithStdin({
      actorHintFromAgentId: true,
      agentId,
      event,
      nativeEvent,
      turnIdFields: ["prompt_id"],
    });
}

/**
 * Claude Code hook 事件 → pier 事件名。
 * 依据官方 hooks reference（code.claude.com/docs/en/hooks）：
 * - 不装 PermissionRequest / Elicitation / ElicitationResult / Notification：
 *   这些事件无法保证稳定请求 ID 且覆盖自动应答、异常、允许、拒绝、取消的
 *   完整结果闭环，因此不能进入 waiting。
 * - StopFailure = 回合因 API 错误终止 → pier "error" → tab failed。
 * - PostToolUseFailure = 单个工具失败, 回合仍在继续 → 视为 ToolComplete
 *   （不闪 error, error 态只留给回合级失败）。
 * - PermissionDenied 是自动权限模式分类器，不能伪装成人工拒绝结果。
 * - PreCompact：长压缩期间无其他 hook, 不装则被 30min TTL 误衰减。
 * - SessionEnd timeout：工厂默认 5s。Claude 默认预算 ~1.5s，settings 可抬高至
 *   60s；5s 在合法范围内，不会像 Codex 那样被 clamp 警告。
 */
const CLAUDE_SPEC: NestedJsonIntegrationSpec = {
  agentId: "claude",
  runtime: { stopAuthority: "advisory" },
  configPath: () => join(homedir(), ".claude", "settings.json"),
  // claude 为旗舰集成：无条件安装（配置不存在则创建）, 保持既有行为。
  detect: () => true,
  // Grok 默认兼容加载 Claude hooks；保留用户兼容设置，但不得重复上报为 Claude。
  skipWhenEnvPresent: ["GROK_HOOK_EVENT"],
  events: [
    {
      buildCommand: claudeStandardCommand("SessionStart", "SessionStart"),
      nativeEvent: "SessionStart",
      pierEvent: "SessionStart",
    },
    {
      nativeEvent: "UserPromptSubmit",
      pierEvent: "PromptSubmit",
      buildCommand: (agentId) => pierClaudeUserPromptSubmitCommandV3(agentId),
    },
    {
      buildCommand: claudeStandardCommand("ToolStart", "PreToolUse"),
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    },
    {
      buildCommand: claudeStandardCommand("ToolComplete", "PostToolUse"),
      nativeEvent: "PostToolUse",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: claudeStandardCommand("ToolComplete", "PostToolUseFailure"),
      nativeEvent: "PostToolUseFailure",
      pierEvent: "ToolComplete",
    },
    {
      buildCommand: claudeStandardCommand("processing", "PreCompact"),
      nativeEvent: "PreCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: claudeStandardCommand("processing", "PostCompact"),
      nativeEvent: "PostCompact",
      pierEvent: "processing",
    },
    {
      buildCommand: claudeStandardCommand("Stop", "Stop"),
      nativeEvent: "Stop",
      pierEvent: "Stop",
    },
    {
      buildCommand: claudeStandardCommand("error", "StopFailure"),
      nativeEvent: "StopFailure",
      pierEvent: "error",
    },
    {
      buildCommand: claudeStandardCommand("SubagentStart", "SubagentStart"),
      nativeEvent: "SubagentStart",
      pierEvent: "SubagentStart",
    },
    {
      buildCommand: claudeStandardCommand("SubagentStop", "SubagentStop"),
      nativeEvent: "SubagentStop",
      pierEvent: "SubagentStop",
    },
    {
      buildCommand: claudeStandardCommand("SessionEnd", "SessionEnd"),
      nativeEvent: "SessionEnd",
      pierEvent: "SessionEnd",
    },
  ],
};

export const CLAUDE_HOOK_EVENTS = CLAUDE_SPEC.events;

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
    (s) => {
      if (!preflightPierNestedHooksInstall(s, CLAUDE_SPEC)) {
        return s;
      }
      return withPierClaudeHooks(withoutPierClaudeHooks(s));
    },
    "claude"
  );
}

export async function uninstallClaudeHooks(
  settingsPath: string = CLAUDE_SPEC.configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withoutPierClaudeHooks, "claude");
}
