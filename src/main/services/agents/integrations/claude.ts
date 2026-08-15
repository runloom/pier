import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { CLAUDE_FAMILY_INTERACTIVE_BLOCKING_TOOLS } from "./interactive-blocking-tools.ts";
import { interactiveBlockingToolLifecycleEvents } from "./interactive-tool-lifecycle.ts";
import {
  createNestedJsonIntegration,
  type NestedJsonIntegrationSpec,
  pierClaudeUserPromptSubmitCommandV3,
  pierHookCommandV3WithStdin,
  preflightPierNestedHooksInstall,
  transformJsonConfig,
  transformPierHooksUnlessNewer,
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
 * - 不装 PermissionRequest / Elicitation / ElicitationResult：
 *   这些事件无法保证稳定请求 ID 且覆盖自动应答、异常、允许、拒绝、取消的
 *   完整结果闭环，因此不能整类进入 waiting。
 * - Notification **只装** matcher=`idle_prompt` → TurnCompleted：
 *   Claude 自报「已空闲、等下一条输入」。**不**改用户全局
 *   `messageIdleNotifThresholdMs`（默认 60s；取消主路径是 host 裸 Esc）。
 * - waiting 仅对 EnterPlanMode / ExitPlanMode / AskUserQuestion 经 Pre/Post
 *   toolUseId 闭环上报（见 CLAUDE_FAMILY_INTERACTIVE_BLOCKING_TOOLS）。
 *   ExitPlanMode 非 teammate 为 permission ask；用户拒绝不跑 call、无 Post。
 * - StopFailure = 回合因 API 错误终止 → pier "error" → tab failed。
 * - 取消主路径：host `pier.terminal.user_escape`（busy 时 TurnInterrupted）。
 *   辅：transcript 中断标记 / assistant_stop；hook Stop 常缺。
 *   hook 常缺 transcriptPath 时按 sessionId 扫描补路径。
 * - PostToolUseFailure = 单个工具失败, 回合仍在继续；普通工具 ToolComplete，
 *   交互工具 InteractionResolved failed（不闪全局 error）。
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
    ...interactiveBlockingToolLifecycleEvents({
      actorHintFromAgentId: true,
      // Claude PostToolUseFailure 原先不抽 error；保持空字段列表避免噪声。
      postToolFailureNativeStateFields: [],
      tools: CLAUDE_FAMILY_INTERACTIVE_BLOCKING_TOOLS,
      turnIdFields: ["prompt_id"],
    }),
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
      // 仅 idle_prompt：Claude 自报空闲（默认阈 60s）。辅证据；不写全局阈值。
      buildCommand: claudeStandardCommand(
        "TurnCompleted",
        "Notification.idle_prompt"
      ),
      matcher: "idle_prompt",
      nativeEvent: "Notification",
      pierEvent: "TurnCompleted",
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

/**
 * 历史 Pier 曾写入的 idle 阈值（800 / 2500）。
 * 现不再写入；install/uninstall 仅清除这些遗留值，不改用户自定义阈值。
 */
export const CLAUDE_IDLE_PROMPT_THRESHOLD_MS = 800;

const PIER_OWNED_IDLE_THRESHOLDS = new Set([
  CLAUDE_IDLE_PROMPT_THRESHOLD_MS,
  2500,
]);

export const CLAUDE_HOOK_EVENTS = CLAUDE_SPEC.events;

const claudeNestedIntegration = createNestedJsonIntegration(CLAUDE_SPEC);

/** 与工厂一致；install 走 withPierClaudeHooks（hooks + 清遗留 idle 阈值）。 */
export const claudeIntegration = {
  ...claudeNestedIntegration,
  install: () => installClaudeHooks(CLAUDE_SPEC.configPath()),
  uninstall: () => uninstallClaudeHooks(CLAUDE_SPEC.configPath()),
};

/** 去掉历史 Pier 写入的 messageIdleNotifThresholdMs；保留用户其它值。 */
function stripPierOwnedIdleThreshold(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const threshold = settings.messageIdleNotifThresholdMs;
  if (
    typeof threshold === "number" &&
    PIER_OWNED_IDLE_THRESHOLDS.has(threshold)
  ) {
    const { messageIdleNotifThresholdMs: _removed, ...rest } = settings;
    return rest;
  }
  return settings;
}

/** 兼容导出：装 hooks，不写全局 idle 阈值（取消主路径 = host Esc）。 */
export function withPierClaudeHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return stripPierOwnedIdleThreshold(
    withPierNestedHooks(settings, CLAUDE_SPEC)
  );
}

export function withoutPierClaudeHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  return stripPierOwnedIdleThreshold(withoutPierNestedHooks(settings));
}

export async function installClaudeHooks(
  settingsPath: string = CLAUDE_SPEC.configPath()
): Promise<void> {
  // 先剔全部 pier 条目再按当前 spec 装, 与工厂 createNestedJsonIntegration
  // 一致——覆盖「上一版 spec 装过但本版已移出」的遗留清理。
  // 磁盘 pier-hook-gen 更高时不降级（多 worktree 共存）。
  await transformJsonConfig(
    settingsPath,
    (s) => {
      if (!preflightPierNestedHooksInstall(s, CLAUDE_SPEC)) {
        return s;
      }
      return transformPierHooksUnlessNewer(s, (current) =>
        withPierClaudeHooks(withoutPierClaudeHooks(current))
      );
    },
    "claude"
  );
}

export async function uninstallClaudeHooks(
  settingsPath: string = CLAUDE_SPEC.configPath()
): Promise<void> {
  await transformJsonConfig(settingsPath, withoutPierClaudeHooks, "claude");
}
