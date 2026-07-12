import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import type { HookScope } from "./entry.ts";
import { TURN_BOUNDARY_EVENTS, TURN_RESET_EVENTS } from "./entry.ts";

/** 回合边界、工具与子代理身份记账。false 表示迟到事件应被吸收。 */
export function applyTurnBookkeeping(
  scope: HookScope,
  event: AgentHookEventPayload
): boolean {
  const eventName = event.event;
  const eventTurnId = event.turnId?.trim();
  if (
    (eventName === "Stop" ||
      eventName === "TurnCompleted" ||
      eventName === "TurnInterrupted") &&
    eventTurnId &&
    scope.currentTurnId &&
    eventTurnId !== scope.currentTurnId
  ) {
    return false;
  }
  if (TURN_BOUNDARY_EVENTS.has(eventName)) {
    scope.turnEnded = true;
    clearActiveWork(scope);
  } else if (TURN_RESET_EVENTS.has(eventName)) {
    scope.turnEnded = false;
    clearActiveWork(scope);
    scope.currentTurnId = eventTurnId;
  } else if (eventName === "PermissionRequest") {
    scope.turnEnded = false;
  } else if (scope.turnEnded) {
    return false;
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
