import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import type { AgentTurnEventSemantics } from "./agent-turn-event-semantics.ts";
import type { HookScope } from "./entry.ts";

const MAX_SETTLED_IDS_PER_KIND = 256;

export interface TerminalRetiredWork {
  interactionCount: number;
  subagentCount: number;
  toolCount: number;
}

export type TurnTransition =
  | "none"
  | "reset"
  | "terminal-candidate"
  | "terminal-trusted";

export type TurnBookkeepingRejectionReason =
  | "foreign-turn"
  | "sealed-turn"
  | "settled-turn"
  | "stop-without-authority";

export type TurnBookkeepingResult =
  | { accepted: false; reason: TurnBookkeepingRejectionReason }
  | {
      accepted: true;
      transition: TurnTransition;
      terminalRetiredWork?: TerminalRetiredWork;
    };

const ACCEPTED_NONE: TurnBookkeepingResult = {
  accepted: true,
  transition: "none",
};

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

function reject(reason: TurnBookkeepingRejectionReason): TurnBookkeepingResult {
  return { accepted: false, reason };
}

function resetTurn(
  scope: HookScope,
  eventTurnId: string | undefined,
  at: number
): void {
  scope.turnEnded = false;
  scope.turnEndedAt = undefined;
  scope.completionObserved = false;
  scope.completionObservedAt = undefined;
  scope.turnResetAt = at;
  clearActiveWork(scope);
  scope.currentTurnId = eventTurnId;
}

function turnStartDecision(
  scope: HookScope,
  semantics: AgentTurnEventSemantics,
  eventTurnId: string | undefined
): "none" | "reset" {
  if (semantics.resetEvidence === "explicit-prompt") {
    return eventTurnId &&
      !scope.turnEnded &&
      eventTurnId === scope.currentTurnId
      ? "none"
      : "reset";
  }
  if (semantics.resetEvidence === "turn-correlatable") {
    if (scope.turnEnded) return "reset";
    if (!scope.currentTurnId) {
      scope.currentTurnId = eventTurnId;
      return "none";
    }
    return eventTurnId === scope.currentTurnId ? "none" : "reset";
  }
  if (semantics.resetEvidence === "provider-authoritative") {
    return scope.turnEnded ? "reset" : "none";
  }
  return "none";
}

/** 回合语义、身份与工作集的唯一可变状态归约器。 */
export function applyTurnBookkeeping(
  scope: HookScope,
  event: AgentHookEventPayload,
  semantics: AgentTurnEventSemantics,
  at: number,
  subagentWorkId?: string
): TurnBookkeepingResult {
  const eventName = event.event;
  const eventTurnId = event.turnId?.trim();
  const isTerminalCorrection =
    scope.turnEnded &&
    scope.status === "ready" &&
    semantics.category === "terminal-trusted" &&
    (semantics.terminalStatus === "error" || eventName === "TurnInterrupted") &&
    (!(eventTurnId && scope.currentTurnId) ||
      eventTurnId === scope.currentTurnId);
  if (semantics.category === "ignored") {
    return reject("stop-without-authority");
  }
  if (
    eventTurnId &&
    scope.recentSettledTurnIds.has(eventTurnId) &&
    !isTerminalCorrection
  ) {
    return reject("settled-turn");
  }
  if (semantics.category === "turn-start") {
    const decision = turnStartDecision(scope, semantics, eventTurnId);
    if (decision === "reset") {
      resetTurn(scope, eventTurnId, at);
      return { accepted: true, transition: "reset" };
    }
  }
  if (
    eventTurnId &&
    scope.currentTurnId &&
    eventTurnId !== scope.currentTurnId &&
    semantics.category !== "turn-start"
  ) {
    return reject("foreign-turn");
  }
  if (scope.turnEnded && !isTerminalCorrection) {
    return reject("sealed-turn");
  }
  if (semantics.category === "terminal-trusted") {
    const settledTurnId = eventTurnId ?? scope.currentTurnId;
    if (settledTurnId) {
      settleNamedWork(scope.recentSettledTurnIds, settledTurnId);
      scope.currentTurnId = settledTurnId;
    }
    scope.turnEnded = true;
    scope.turnEndedAt = at;
    scope.completionObserved = false;
    scope.completionObservedAt = undefined;
    const terminalRetiredWork = clearActiveWork(scope);
    return {
      accepted: true,
      transition: "terminal-trusted",
      ...(terminalRetiredWork ? { terminalRetiredWork } : {}),
    };
  }
  if (semantics.category === "terminal-candidate") {
    scope.completionObserved = true;
    scope.completionObservedAt = at;
    clearActiveWork(scope);
    return { accepted: true, transition: "terminal-candidate" };
  }
  if (
    scope.completionObserved &&
    (semantics.category === "turn-start" ||
      semantics.category === "progress" ||
      semantics.category === "work")
  ) {
    scope.completionObserved = false;
    scope.completionObservedAt = undefined;
  }
  if (eventName === "SessionEnd") {
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
        return ACCEPTED_NONE;
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
        return ACCEPTED_NONE;
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
        return ACCEPTED_NONE;
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
  return ACCEPTED_NONE;
}

function clearActiveWork(scope: HookScope): TerminalRetiredWork | undefined {
  const terminalRetiredWork = {
    interactionCount:
      scope.activeInteractionIds.size + scope.anonymousInteractionCount,
    subagentCount: scope.activeSubagentIds.size + scope.anonymousSubagentCount,
    toolCount: scope.activeToolIds.size + scope.anonymousToolCount,
  };
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
  return terminalRetiredWork.interactionCount > 0 ||
    terminalRetiredWork.subagentCount > 0 ||
    terminalRetiredWork.toolCount > 0
    ? terminalRetiredWork
    : undefined;
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
  semantics: AgentTurnEventSemantics
): ActivityStatus | undefined {
  if (scope.completionObserved) {
    return;
  }
  if (hookScopeHasActiveInteractions(scope)) {
    return "waiting";
  }
  if (hookScopeHasActiveTools(scope)) {
    return "tool";
  }
  return semantics.mappedStatus ?? undefined;
}
