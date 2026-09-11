import { isSubagentHookEvent } from "@shared/agent-session-actor.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import type { HookScope } from "./entry.ts";
import {
  hookScopeHasActiveInteractions,
  hookScopeHasActiveTools,
} from "./turn-ledger.ts";
import { hookEventTimeMs } from "./turn-unseal.ts";

/** idle 是当前主循环事实；仍活跃的工作项有自己的闭合证据。 */
export function statusWithNativeIdle(
  scope: HookScope,
  fallback: ActivityStatus | undefined
): ActivityStatus | undefined {
  if (scope.idleObservedAt === undefined || scope.turnEnded) return fallback;
  if (scope.displayQuestionId || hookScopeHasActiveInteractions(scope)) {
    return "waiting";
  }
  if (hookScopeHasActiveTools(scope)) return "tool";
  if (scope.activeSubagentIds.size + scope.anonymousSubagentCount > 0) {
    return "processing";
  }
  return "ready";
}

export function isStaleActivityIdle(
  scope: HookScope,
  event: AgentHookEventPayload,
  at: number
): boolean {
  return (
    event.event === "ActivityIdle" &&
    (isSubagentHookEvent(event) ||
      hookEventTimeMs(event, at) < (scope.mainProgressAt ?? 0))
  );
}

/** 只在事件通过身份/时间校验后调用；子事件及工作结束不会否定主循环空闲。 */
export function recordMainActivity(
  scope: HookScope,
  event: AgentHookEventPayload,
  at: number
): void {
  if (isSubagentHookEvent(event)) return;
  if (event.event === "ActivityIdle") {
    scope.idleObservedAt = hookEventTimeMs(event, at);
    return;
  }
  if (
    event.event === "PromptSubmit" ||
    event.event === "running" ||
    event.event === "processing" ||
    event.event === "ToolStart" ||
    event.event === "InteractionRequested"
  ) {
    if (
      hookEventTimeMs(event, at) <
      Math.max(scope.mainProgressAt ?? 0, scope.idleObservedAt ?? 0)
    )
      return;
    scope.mainProgressAt = Math.max(
      scope.mainProgressAt ?? 0,
      hookEventTimeMs(event, at)
    );
    scope.idleObservedAt = undefined;
    scope.pendingMaintenance = undefined;
  }
}
