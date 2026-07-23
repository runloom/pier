import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import type { HookScope } from "./entry.ts";
import { TURN_BOUNDARY_EVENTS, TURN_RESET_EVENTS } from "./entry.ts";
import type { AgentStopAuthority } from "./types.ts";

/** 回合边界、工具与子代理身份记账。false 表示迟到事件应被吸收。 */
export function applyTurnBookkeeping(
  scope: HookScope,
  event: AgentHookEventPayload,
  stopAuthority: AgentStopAuthority,
  at: number
): boolean {
  const eventName = event.event;
  const eventTurnId = event.turnId?.trim();
  // `none` 表示该集成没有可用的 Stop 事实；历史残留或异常 producer 的
  // Stop 必须整条丢弃，不能借 canonical 名称意外制造 ready。
  if (eventName === "Stop" && stopAuthority === "none") {
    return false;
  }
  if (
    eventTurnId &&
    scope.currentTurnId &&
    eventTurnId !== scope.currentTurnId &&
    !TURN_RESET_EVENTS.has(eventName)
  ) {
    return false;
  }
  if (eventTurnId && scope.recentSettledTurnIds.has(eventTurnId)) {
    return false;
  }
  if (scope.turnEnded && !TURN_RESET_EVENTS.has(eventName)) {
    return false;
  }
  const isTerminal =
    eventName === "TurnCompleted" ||
    eventName === "TurnInterrupted" ||
    eventName === "error" ||
    (eventName === "Stop" &&
      (stopAuthority === "authoritative" || stopAuthority === "reset-only"));
  if (isTerminal && eventTurnId) {
    if (scope.recentSettledTurnIds.has(eventTurnId)) {
      return false;
    }
    scope.recentSettledTurnIds.add(eventTurnId);
    if (scope.recentSettledTurnIds.size > 256) {
      scope.recentSettledTurnIds.delete(
        scope.recentSettledTurnIds.values().next().value ?? ""
      );
    }
  }
  if (TURN_BOUNDARY_EVENTS.has(eventName)) {
    scope.turnEnded = true;
    scope.turnEndedAt = at;
    scope.completionObserved = false;
    scope.completionObservedAt = undefined;
    clearActiveWork(scope);
  } else if (TURN_RESET_EVENTS.has(eventName)) {
    scope.turnEnded = false;
    scope.turnEndedAt = undefined;
    scope.completionObserved = false;
    scope.completionObservedAt = undefined;
    scope.turnResetAt = at;
    clearActiveWork(scope);
    scope.currentTurnId = eventTurnId;
  } else if (eventName === "PermissionRequest") {
    scope.turnEnded = false;
    scope.turnEndedAt = undefined;
    scope.completionObserved = false;
    scope.completionObservedAt = undefined;
  } else if (eventName === "Stop" && stopAuthority === "advisory") {
    scope.completionObserved = true;
    scope.completionObservedAt = at;
    clearActiveWork(scope);
  } else if (eventName === "Stop") {
    scope.turnEnded = true;
    scope.turnEndedAt = at;
    scope.completionObserved = false;
    scope.completionObservedAt = undefined;
    clearActiveWork(scope);
  } else if (
    scope.completionObserved &&
    (eventName === "ToolStart" ||
      eventName === "SubagentStart" ||
      eventName === "processing" ||
      eventName === "running")
  ) {
    scope.completionObserved = false;
    scope.completionObservedAt = undefined;
  }
  if (eventName === "Stop" || eventName === "SessionEnd") {
    clearActiveWork(scope);
  } else if (eventName === "ToolStart") {
    const id = event.toolUseId?.trim();
    if (id) scope.activeToolIds.add(id);
    else scope.anonymousToolCount += 1;
  } else if (eventName === "ToolComplete") {
    const id = event.toolUseId?.trim();
    if (id) scope.activeToolIds.delete(id);
    else scope.anonymousToolCount = Math.max(0, scope.anonymousToolCount - 1);
  } else if (eventName === "SubagentStart") {
    const id = event.agentInstanceId?.trim();
    if (id) scope.activeSubagentIds.add(id);
    else scope.anonymousSubagentCount += 1;
  } else if (eventName === "SubagentStop") {
    const id = event.agentInstanceId?.trim();
    if (id) scope.activeSubagentIds.delete(id);
    else {
      scope.anonymousSubagentCount = Math.max(
        0,
        scope.anonymousSubagentCount - 1
      );
    }
  }
  scope.subagentCount =
    scope.activeSubagentIds.size + scope.anonymousSubagentCount;
  return true;
}

function clearActiveWork(scope: HookScope): void {
  scope.activeSubagentIds.clear();
  scope.activeToolIds.clear();
  scope.anonymousSubagentCount = 0;
  scope.anonymousToolCount = 0;
  scope.subagentCount = 0;
}

export function hookScopeHasActiveTools(scope: HookScope): boolean {
  return scope.activeToolIds.size > 0 || scope.anonymousToolCount > 0;
}

/** ToolComplete 后若仍有未完成工具则维持 tool，否则沿用映射表（通常 processing）。 */
export function nextStatusAfterTurnBookkeeping(
  scope: HookScope,
  event: AgentHookEventPayload,
  mappedStatus: ActivityStatus | undefined
): ActivityStatus | undefined {
  if (scope.completionObserved) {
    return;
  }
  if (event.event === "ToolComplete" && hookScopeHasActiveTools(scope)) {
    return "tool";
  }
  return mappedStatus;
}
