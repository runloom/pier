import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type {
  ActivityStatus,
  ForegroundActivity,
} from "@shared/contracts/foreground-activity.ts";

/** 这些 activity 状态下用户 Esc 视为取消当前智能体回合。 */
const ESCAPE_CANCEL_STATUSES = new Set<ActivityStatus>([
  "processing",
  "tool",
  "running",
]);

/** 与证据矩阵 / FA 摄入一致的 nativeEvent 字面量。 */
export const PIER_TERMINAL_USER_ESCAPE = "pier.terminal.user_escape";

/**
 * 终端裸 Esc 是否应把当前 panel 的 agent 活动对账为 TurnInterrupted。
 *
 * 仅活体 agent + 忙态；shell/idle/ready/waiting 不处理（waiting 用交互闭环）。
 * 不验证 TUI 是否已停模型：产品状态跟用户手势对齐（乐观 ready）。
 */
export function shouldCancelAgentOnTerminalEscape(
  activity: ForegroundActivity | undefined
): activity is Extract<ForegroundActivity, { kind: "agent" }> {
  if (activity?.kind !== "agent") {
    return false;
  }
  const status = activity.status;
  return status !== undefined && ESCAPE_CANCEL_STATUSES.has(status);
}

/**
 * 构造 Esc 取消终态事件（v3）。
 * evidence 走 transcript 摄入路径 → stopAuthority authoritative。
 */
export function buildTerminalEscapeCancelEvent(input: {
  agentId: Extract<ForegroundActivity, { kind: "agent" }>["agentId"];
  panelId: string;
  windowId: string;
  sessionId?: string | undefined;
}): AgentHookEventPayload {
  return {
    agent: input.agentId,
    event: "TurnInterrupted",
    kind: "agentEvent",
    nativeEvent: PIER_TERMINAL_USER_ESCAPE,
    panelId: input.panelId,
    v: 3,
    windowId: input.windowId,
    ...(input.sessionId?.trim() ? { sessionId: input.sessionId.trim() } : {}),
  };
}
