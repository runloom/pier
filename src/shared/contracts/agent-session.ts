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
 * hook 脚本 POST 到 loopback 服务器的事件体（v1）。
 * panelId 跨窗口不唯一（见 terminal-panel-id.ts），windowId 必带，
 * 二者组成会话 key `${windowId}::${panelId}`。
 */
export const agentHookEventSchema = z
  .object({
    v: z.literal(1),
    agent: agentKindSchema,
    event: z.string().min(1).max(64),
    panelId: z.string().min(1).max(128),
    sessionId: z.string().max(128).optional(),
    windowId: z.string().min(1).max(32),
  })
  .strict();
export type AgentHookEvent = z.infer<typeof agentHookEventSchema>;

export const agentSessionSourceSchema = z.enum(["hook", "title"]);
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
