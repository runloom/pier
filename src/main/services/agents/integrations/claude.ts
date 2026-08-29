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
 * Subagent 生命周期专用提取（2026-08-29 审计）：载荷用**父会话**
 * session_id + agent_id/agent_type——sessionIdAsParent 让实例别名承担
 * 子智能体身份，并行子智能体不再共享 `session:<父>` 别名（否则第二个
 * SubagentStart 复用第一个的 work 关联：计数停在 1、首个 Stop 提前清账、
 * 第二个 Stop 被 settled 丢弃）。prompt_id 是主回合恒定值，保留提取。
 */
function claudeSubagentCommand(
  event: "SubagentStart" | "SubagentStop",
  nativeEvent: string
): (agentId: AgentKind) => string {
  return (agentId) =>
    pierHookCommandV3WithStdin({
      actorHintFromAgentId: true,
      agentId,
      event,
      nativeEvent,
      sessionIdAsParent: true,
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
  // 兼容宿主守卫：Grok、cursor-agent、devin 都会加载
  // `~/.claude/settings.json`（cursor-agent 2026.08.25 bundle：
  // claudeUserConfigPath + Claude 事件名映射表；devin 官方
  // read_config_from.claude 默认开启），命中宿主标志时跳过，避免在别家
  // 会话内重复上报为 Claude——cursor 会话内实测每个工具调用双写
  // agent=claude 行，被 foreign-agent 闸门丢弃但白耗 emit 进程与锁竞争，
  // 且先到者会错锁面板身份。宿主标志（各自 hook 子进程恒注入、真 Claude
  // 不设置）：GROK_HOOK_EVENT（grok）、CURSOR_VERSION（cursor-agent
  // buildHookEnvironment）、DEVIN_PROJECT_DIR（devin hooks 文档）。
  // 注意 CLAUDE_PROJECT_DIR 三家宿主都兼容注入，绝不可作判据。
  skipWhenEnvPresent: [
    "GROK_HOOK_EVENT",
    "CURSOR_VERSION",
    "DEVIN_PROJECT_DIR",
  ],
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
      buildCommand: claudeSubagentCommand("SubagentStart", "SubagentStart"),
      nativeEvent: "SubagentStart",
      pierEvent: "SubagentStart",
    },
    {
      buildCommand: claudeSubagentCommand("SubagentStop", "SubagentStop"),
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
