import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import {
  type AgentTerminalEvidence,
  type AgentTurnEventSemantics,
  normalizeAgentTurnId,
} from "./agent-turn-event-semantics.ts";
import { statusWithDisplayQuestion } from "./display-question.ts";
import type { HookScope } from "./entry.ts";
import { isPlanApprovalToolName } from "./plan-approval.ts";

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

const TERMINAL_EVIDENCE_STRENGTH: Readonly<
  Record<AgentTerminalEvidence, number>
> = {
  ready: 1,
  interrupted: 2,
  error: 3,
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

function eventToolName(event: AgentHookEventPayload): string | undefined {
  return "toolName" in event ? event.toolName?.trim() || undefined : undefined;
}

function eventInteractionId(event: AgentHookEventPayload): string | undefined {
  return "interactionId" in event
    ? event.interactionId?.trim() || undefined
    : undefined;
}

function interactiveToolWorkId(
  event: AgentHookEventPayload,
  toolName: string
): string {
  return event.toolUseId?.trim() || `interactive:${toolName}`;
}

/** 仅 plan 审批的 ToolStart 记为可顶替 waiting。问卷必须走具名 Interaction。 */
function promoteInteractiveToolStart(
  scope: HookScope,
  event: AgentHookEventPayload,
  toolName: string
): void {
  const id = interactiveToolWorkId(event, toolName);
  const alreadyNamed = scope.activeInteractionIds.has(id);
  reopenNamedWork(scope.settledInteractionIds, id);
  scope.activeInteractionIds.add(id);
  if (!alreadyNamed) {
    scope.activePlanInteractionIds.add(id);
  }
}

function settlePlanApprovalId(scope: HookScope, id: string): void {
  settleNamedWork(scope.settledInteractionIds, id, () => {
    scope.interactionHistoryIncomplete = true;
  });
  scope.activeInteractionIds.delete(id);
  scope.activePlanInteractionIds.delete(id);
}

/** 可顶替 waiting（plan / 仅 ToolStart 的阻塞工具）在再次出示、具名非 plan 交互或普通 ToolStart 时结算。 */
function settleActivePlanApprovals(scope: HookScope): void {
  if (scope.activePlanInteractionIds.size === 0) {
    return;
  }
  for (const id of [...scope.activePlanInteractionIds]) {
    settlePlanApprovalId(scope, id);
  }
}

function resetTurn(
  scope: HookScope,
  eventTurnId: string | undefined,
  at: number
): void {
  const previousTurnId = normalizeAgentTurnId(scope.currentTurnId);
  if (previousTurnId && previousTurnId !== eventTurnId) {
    settleNamedWork(scope.recentSettledTurnIds, previousTurnId);
  }
  scope.turnEnded = false;
  scope.turnEndedAt = undefined;
  scope.completionObserved = false;
  scope.completionObservedAt = undefined;
  scope.turnResetAt = at;
  scope.terminalEvidence = undefined;
  clearActiveWork(scope);
  scope.currentTurnId = eventTurnId;
}

function isStrongerTerminalCorrection(
  scope: HookScope,
  semantics: AgentTurnEventSemantics,
  eventTurnId: string | undefined
): boolean {
  if (!(scope.turnEnded && semantics.category === "terminal-trusted")) {
    return false;
  }
  if (eventTurnId !== undefined && eventTurnId !== scope.currentTurnId) {
    return false;
  }
  const incoming = semantics.terminalEvidence;
  if (!incoming) {
    return false;
  }
  const current = scope.terminalEvidence;
  return (
    TERMINAL_EVIDENCE_STRENGTH[incoming] >
    (current ? TERMINAL_EVIDENCE_STRENGTH[current] : 0)
  );
}

/** 无 PromptSubmit 的新回合（方案 Build 后直接 ToolStart / stop）可认领未结算 turnId。 */
function canAdoptUnsettledTurn(semantics: AgentTurnEventSemantics): boolean {
  if (semantics.category === "terminal-trusted") {
    return true;
  }
  return (
    semantics.category === "work" &&
    (semantics.mappedStatus === "tool" || semantics.mappedStatus === "waiting")
  );
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
  const eventTurnId = normalizeAgentTurnId(event.turnId);
  const isTerminalCorrection = isStrongerTerminalCorrection(
    scope,
    semantics,
    eventTurnId
  );
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
  let adoptedUnsettledTurn = false;
  if (
    eventTurnId &&
    scope.currentTurnId &&
    eventTurnId !== scope.currentTurnId &&
    semantics.category !== "turn-start"
  ) {
    if (canAdoptUnsettledTurn(semantics)) {
      resetTurn(scope, eventTurnId, at);
      adoptedUnsettledTurn = true;
    } else {
      return reject("foreign-turn");
    }
  }
  if (scope.turnEnded && !isTerminalCorrection) {
    if (eventName !== "InteractionRequested") {
      return reject("sealed-turn");
    }
    // transcript 问卷可在 stop/abort 之后仍挂在末行；具名请求重开 waiting。
    scope.completionObserved = false;
    scope.completionObservedAt = undefined;
    scope.terminalEvidence = undefined;
    scope.turnEnded = false;
    scope.turnEndedAt = undefined;
  }
  if (
    eventTurnId &&
    !scope.currentTurnId &&
    (semantics.category === "work" || semantics.category === "progress")
  ) {
    // 无 PromptSubmit 的工具会话也要挂上 turnId，否则同 generation 的对侧
    // 终态无法把分裂 scope 关联起来（Cursor 工具 hook 常走另一 conversation）。
    scope.currentTurnId = eventTurnId;
  }
  if (semantics.category === "terminal-trusted") {
    const settledTurnId = eventTurnId ?? scope.currentTurnId;
    if (settledTurnId) {
      settleNamedWork(scope.recentSettledTurnIds, settledTurnId);
      scope.currentTurnId = settledTurnId;
    }
    scope.turnEnded = true;
    scope.turnEndedAt = at;
    scope.terminalEvidence = semantics.terminalEvidence;
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
    scope.terminalEvidence = undefined;
    clearActiveWork(scope);
    return { accepted: true, transition: "terminal-candidate" };
  }
  if (scope.completionObserved && semantics.cancelsTerminalCandidate) {
    scope.completionObserved = false;
    scope.completionObservedAt = undefined;
  }
  if (semantics.category === "session-end") {
    clearActiveWork(scope);
  } else if (eventName === "InteractionRequested") {
    const id = eventInteractionId(event);
    const planApproval = isPlanApprovalToolName(eventToolName(event));
    if (id) {
      settleActivePlanApprovals(scope);
      reopenNamedWork(scope.settledInteractionIds, id);
      scope.activeInteractionIds.add(id);
      if (planApproval) {
        scope.activePlanInteractionIds.add(id);
      }
    } else {
      scope.anonymousInteractionCount += 1;
    }
  } else if (eventName === "InteractionResolved") {
    const id = eventInteractionId(event);
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
      scope.activePlanInteractionIds.delete(id);
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
    const toolName = eventToolName(event);
    if (isPlanApprovalToolName(toolName) && toolName) {
      promoteInteractiveToolStart(scope, event, toolName);
    } else {
      settleActivePlanApprovals(scope);
      const id = event.toolUseId?.trim();
      if (id) {
        reopenNamedWork(scope.settledToolIds, id);
        scope.activeToolIds.add(id);
      } else {
        scope.anonymousToolCount += 1;
      }
    }
  } else if (eventName === "ToolComplete") {
    const toolName = eventToolName(event);
    if (isPlanApprovalToolName(toolName) && toolName) {
      settlePlanApprovalId(scope, interactiveToolWorkId(event, toolName));
    } else {
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
  return adoptedUnsettledTurn
    ? { accepted: true, transition: "reset" }
    : ACCEPTED_NONE;
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
  scope.activePlanInteractionIds.clear();
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
  if (scope.displayQuestionId) {
    return statusWithDisplayQuestion(scope, semantics, "waiting");
  }
  if (scope.turnEnded) {
    return scope.terminalEvidence === "error" ? "error" : "ready";
  }
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
