import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import {
  type ActivityStatus,
  activityStatusForHookEvent,
} from "@shared/contracts/foreground-activity.ts";
import { SESSION_CREATING_EVENTS } from "./entry.ts";

const LEGACY_PERMISSION_REQUEST_EVENT = "PermissionRequest";

/**
 * v1/v2 hook 兼容读取边界。
 *
 * 严格 v3 schema 与状态词汇不再接受单边 PermissionRequest；只有已落盘的
 * 旧协议事件在进入聚合器时临时归一为 waiting。
 */
export function activityStatusForAgentHookEvent(
  event: AgentHookEventPayload
): ActivityStatus | null | undefined {
  if (event.event === "SessionStart" || event.event === "SessionEnd") {
    return;
  }
  if (event.v !== 3 && event.event === LEGACY_PERMISSION_REQUEST_EVENT) {
    return "waiting";
  }
  return activityStatusForHookEvent(event.event);
}

export function isSessionCreatingAgentHookEvent(
  event: AgentHookEventPayload
): boolean {
  return (
    SESSION_CREATING_EVENTS.has(event.event) ||
    (event.v !== 3 && event.event === LEGACY_PERMISSION_REQUEST_EVENT)
  );
}
