import { z } from "zod";
import { type AgentKind, agentKindSchema } from "./agent.ts";
import type { PanelTabStatus } from "./panel.ts";

/** agent 会话的运行时状态（借鉴 loomdesk 五态模型）。 */
export const agentRuntimeStatusSchema = z.enum([
  "ready",
  "processing",
  "tool",
  "waiting",
  "error",
]);
export type AgentRuntimeStatus = z.infer<typeof agentRuntimeStatusSchema>;

/**
 * hook 事件（v1）——三 kind discriminated union（spec §4.4）。
 *
 * emit 脚本 dispatch：`$1` 位置参数选一 kind, 剩余参数填入对应 payload。
 * 两条 producer 只写 `agentEvent`（现役 Path B）；`commandStart` / `commandFinished`
 * kind 是 forward-compat 占位——未来非 ghostty native shell 需要经 JSONL 上报
 * 命令生命周期时启用。JsonlObserver 按 kind 分派到对应回调, aggregator 独立
 * 消费。
 *
 * 字段顺序（emit 脚本保序）：v → kind → ts → panelId → windowId → pid → payload。
 * panelId 跨窗口不唯一（见 terminal-panel-id.ts），windowId 必带，
 * 二者组成会话 key `${windowId}::${panelId}`。
 */
const baseHookFields = {
  v: z.literal(1),
  ts: z.number().optional(),
  panelId: z.string().min(1).max(128),
  windowId: z.string().min(1).max(32),
  pid: z.number().optional(),
};

const commandStartEventSchema = z
  .object({
    kind: z.literal("commandStart"),
    ...baseHookFields,
    commandLine: z.string().max(4096),
  })
  .strict();
export type CommandStartHookEvent = z.infer<typeof commandStartEventSchema>;

const commandFinishedEventSchema = z
  .object({
    kind: z.literal("commandFinished"),
    ...baseHookFields,
    exitCode: z.number().int(),
  })
  .strict();
export type CommandFinishedHookEvent = z.infer<
  typeof commandFinishedEventSchema
>;

const agentEventPayloadSchema = z
  .object({
    kind: z.literal("agentEvent"),
    ...baseHookFields,
    agent: agentKindSchema,
    event: z.string().min(1).max(64),
    sessionId: z.string().max(128).optional(),
  })
  .strict();
export type AgentHookEventPayload = z.infer<typeof agentEventPayloadSchema>;

export const agentHookEventSchema = z.discriminatedUnion("kind", [
  commandStartEventSchema,
  commandFinishedEventSchema,
  agentEventPayloadSchema,
]);
export type AgentHookEvent = z.infer<typeof agentHookEventSchema>;

export const agentSessionSourceSchema = z.enum(["hook", "launch"]);
export type AgentSessionSource = z.infer<typeof agentSessionSourceSchema>;

export const agentSessionSnapshotSchema = z.object({
  agentId: agentKindSchema.optional(),
  panelId: z.string().min(1),
  source: agentSessionSourceSchema,
  /** 状态最近一次「变化」的时刻（同状态内的心跳事件不重置，供 UI 计时）。 */
  stateStartedAt: z.number(),
  status: agentRuntimeStatusSchema,
  subagentCount: z.number().int().nonnegative(),
  /** 最近一次收到任何信号的时刻（TTL 衰减依据）。 */
  updatedAt: z.number(),
  /** 所属 BrowserWindow id（String(win.id)），与 panelId 组成全局唯一 key。 */
  windowId: z.string().min(1),
});
export type AgentSessionSnapshot = z.infer<typeof agentSessionSnapshotSchema>;

export const agentSessionsBroadcastSchema = z.object({
  sessions: z.array(agentSessionSnapshotSchema),
  /** 单调递增广播序号（非 wall-clock——毫秒会并列, 破坏 store 单调守卫）。 */
  ts: z.number(),
});
export type AgentSessionsBroadcast = z.infer<
  typeof agentSessionsBroadcastSchema
>;

/** hook 事件名 → runtime status。null = 未知事件，调用方应忽略。 */
export function runtimeStatusForHookEvent(
  event: string
): AgentRuntimeStatus | null {
  switch (event) {
    case "PermissionRequest":
      return "waiting";
    case "ToolStart":
    case "ToolComplete":
      return "tool";
    case "error":
      return "error";
    case "SessionStart":
    case "Stop":
    case "SessionEnd":
      return "ready";
    case "PromptSubmit":
    case "SubagentStart":
    case "SubagentStop":
    case "processing":
    case "running":
      return "processing";
    default:
      return null;
  }
}

/** tab icon id 的 agent 命名空间前缀（renderer tab 头按此识别并渲染 AgentIcon）。 */
const AGENT_TAB_ICON_PREFIX = "agent:";

export function agentTabIconId(agentId: AgentKind): string {
  return `${AGENT_TAB_ICON_PREFIX}${agentId}`;
}

export function agentKindFromTabIconId(
  iconId: string | undefined
): AgentKind | null {
  if (!iconId?.startsWith(AGENT_TAB_ICON_PREFIX)) {
    return null;
  }
  const parsed = agentKindSchema.safeParse(
    iconId.slice(AGENT_TAB_ICON_PREFIX.length)
  );
  return parsed.success ? parsed.data : null;
}

/** runtime status → 现有 tab 指示器状态。ready 映射 idle = tab 无指示器。 */
export function tabStatusForAgentStatus(
  status: AgentRuntimeStatus
): PanelTabStatus {
  switch (status) {
    case "processing":
    case "tool":
      return "running";
    case "waiting":
      return "waiting";
    case "error":
      return "failed";
    case "ready":
      return "idle";
    default:
      return "idle";
  }
}
