import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import type { HookScope } from "./entry.ts";
import { TURN_BOUNDARY_EVENTS, TURN_RESET_EVENTS } from "./entry.ts";
import type { AgentStopAuthority } from "./types.ts";

const MAX_SETTLED_IDS_PER_KIND = 256;

function reopenNamedWork(settledIds: Set<string>, id: string): void {
  settledIds.delete(id);
}

function settleNamedWork(
  settledIds: Set<string>,
  id: string,
  markHistoryIncomplete?: () => void
): boolean {
  if (settledIds.has(id)) {
    return false;
  }
  settledIds.add(id);
  if (settledIds.size > MAX_SETTLED_IDS_PER_KIND) {
    const oldestId = settledIds.values().next().value;
    if (oldestId !== undefined) {
      settledIds.delete(oldestId);
      markHistoryIncomplete?.();
    }
  }
  return true;
}

/** 回合边界、工具与子代理身份记账。false 表示迟到事件应被吸收。 */
export function applyTurnBookkeeping(
  scope: HookScope,
  event: AgentHookEventPayload,
  stopAuthority: AgentStopAuthority,
  at: number,
  subagentWorkId?: string
): boolean {
  const eventName = event.event;
  const eventTurnId = event.turnId?.trim();
  // 某些提供方先发通用 Stop，再在稍后的终止通知里给出更精确的错误或
  // 中断原因。只允许 ready 终态被更强事实纠正；error 不会被中断降级，
  // 活跃状态也不会借此绕过回合闸门。
  const isTerminalCorrection =
    scope.turnEnded &&
    scope.status === "ready" &&
    (eventName === "error" || eventName === "TurnInterrupted");
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
  if (
    eventTurnId &&
    scope.recentSettledTurnIds.has(eventTurnId) &&
    !isTerminalCorrection
  ) {
    return false;
  }
  if (
    scope.turnEnded &&
    !TURN_RESET_EVENTS.has(eventName) &&
    !isTerminalCorrection
  ) {
    return false;
  }
  const isTerminal =
    eventName === "TurnCompleted" ||
    eventName === "TurnInterrupted" ||
    eventName === "error" ||
    (eventName === "Stop" &&
      (stopAuthority === "authoritative" || stopAuthority === "reset-only"));
  if (isTerminal && eventTurnId) {
    if (scope.recentSettledTurnIds.has(eventTurnId) && !isTerminalCorrection) {
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
      eventName === "InteractionRequested" ||
      eventName === "processing" ||
      eventName === "running")
  ) {
    scope.completionObserved = false;
    scope.completionObservedAt = undefined;
  }
  if (eventName === "Stop" || eventName === "SessionEnd") {
    clearActiveWork(scope);
  } else if (eventName === "InteractionRequested") {
    const id =
      "interactionId" in event ? event.interactionId?.trim() : undefined;
    if (id) {
      reopenNamedWork(scope.settledInteractionIds, id);
      scope.activeInteractionIds.add(id);
    } else {
      scope.anonymousInteractionCount += 1;
    }
  } else if (eventName === "InteractionResolved") {
    const id =
      "interactionId" in event ? event.interactionId?.trim() : undefined;
    if (id) {
      const historyIncomplete = scope.interactionHistoryIncomplete;
      if (
        !settleNamedWork(scope.settledInteractionIds, id, () => {
          scope.interactionHistoryIncomplete = true;
        })
      ) {
        return true;
      }
      const removed = scope.activeInteractionIds.delete(id);
      if (
        !(removed || historyIncomplete) &&
        scope.anonymousInteractionCount > 0
      ) {
        scope.anonymousInteractionCount -= 1;
      }
    } else {
      scope.anonymousInteractionCount = Math.max(
        0,
        scope.anonymousInteractionCount - 1
      );
    }
  } else if (eventName === "ToolStart") {
    const id = event.toolUseId?.trim();
    if (id) {
      reopenNamedWork(scope.settledToolIds, id);
      scope.activeToolIds.add(id);
    } else {
      scope.anonymousToolCount += 1;
    }
  } else if (eventName === "ToolComplete") {
    const id = event.toolUseId?.trim();
    if (id) {
      const historyIncomplete = scope.toolHistoryIncomplete;
      if (
        !settleNamedWork(scope.settledToolIds, id, () => {
          scope.toolHistoryIncomplete = true;
        })
      ) {
        return true;
      }
      const removed = scope.activeToolIds.delete(id);
      if (!(removed || historyIncomplete) && scope.anonymousToolCount > 0) {
        scope.anonymousToolCount -= 1;
      }
    } else {
      scope.anonymousToolCount = Math.max(0, scope.anonymousToolCount - 1);
    }
  } else if (eventName === "SubagentStart") {
    const id = subagentWorkId;
    if (id) {
      reopenNamedWork(scope.settledSubagentIds, id);
      scope.activeSubagentIds.add(id);
    } else {
      scope.anonymousSubagentCount += 1;
    }
  } else if (eventName === "SubagentStop") {
    const id = subagentWorkId;
    if (id) {
      if (!settleNamedWork(scope.settledSubagentIds, id)) {
        return true;
      }
      const removed = scope.activeSubagentIds.delete(id);
      if (!removed && scope.anonymousSubagentCount > 0) {
        scope.anonymousSubagentCount -= 1;
      }
    } else {
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
  if (
    scope.activeInteractionIds.size > 0 ||
    scope.anonymousInteractionCount > 0 ||
    scope.settledInteractionIds.size > 0
  ) {
    scope.interactionHistoryIncomplete = true;
  }
  if (
    scope.activeToolIds.size > 0 ||
    scope.anonymousToolCount > 0 ||
    scope.settledToolIds.size > 0
  ) {
    scope.toolHistoryIncomplete = true;
  }
  scope.activeInteractionIds.clear();
  scope.activeSubagentIds.clear();
  scope.activeToolIds.clear();
  scope.anonymousInteractionCount = 0;
  scope.anonymousSubagentCount = 0;
  scope.anonymousToolCount = 0;
  scope.settledInteractionIds.clear();
  scope.settledSubagentIds.clear();
  scope.settledToolIds.clear();
  scope.subagentCount = 0;
}

export function hookScopeHasActiveTools(scope: HookScope): boolean {
  return scope.activeToolIds.size > 0 || scope.anonymousToolCount > 0;
}

export function hookScopeHasActiveInteractions(scope: HookScope): boolean {
  return (
    scope.activeInteractionIds.size > 0 || scope.anonymousInteractionCount > 0
  );
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
  if (hookScopeHasActiveInteractions(scope)) {
    return "waiting";
  }
  if (event.event === "InteractionResolved") {
    return hookScopeHasActiveTools(scope) ? "tool" : "processing";
  }
  if (event.event === "ToolComplete" && hookScopeHasActiveTools(scope)) {
    return "tool";
  }
  return mappedStatus;
}
