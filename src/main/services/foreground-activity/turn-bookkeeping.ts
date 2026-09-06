import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { isStaleActivityIdle, recordMainActivity } from "./activity-idle.ts";
import {
  type AgentTerminalEvidence,
  type AgentTurnEventSemantics,
  normalizeAgentTurnId,
} from "./agent-turn-event-semantics.ts";
import type { HookScope } from "./entry.ts";
import { applyMaintenanceObservation } from "./maintenance-observation.ts";
import { isPlanApprovalToolName } from "./plan-approval.ts";
import {
  clearActiveWork,
  reopenNamedWork,
  settleNamedWork,
  type TerminalRetiredWork,
} from "./turn-ledger.ts";
import {
  canUnsealTranscriptTurn,
  hookEventTimeMs,
  isStaleTurnEvent,
  unsealTranscriptTurn,
} from "./turn-unseal.ts";
import type { AgentEventEvidenceSource } from "./types.ts";

export {
  hookScopeHasActiveInteractions,
  hookScopeHasActiveTools,
  type TerminalRetiredWork,
} from "./turn-ledger.ts";
export { nextStatusAfterTurnBookkeeping } from "./turn-status.ts";

export type TurnTransition =
  | "none"
  | "reset"
  | "observation"
  | "activity-idle"
  | "terminal-candidate"
  | "terminal-trusted";

export type TurnBookkeepingRejectionReason =
  | "abandoned-turn"
  | "foreign-turn"
  | "sealed-turn"
  | "settled-turn"
  | "stale-event"
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
  event: AgentHookEventPayload,
  at: number
): void {
  const eventTurnId = normalizeAgentTurnId(event.turnId);
  const previousTurnId = normalizeAgentTurnId(scope.currentTurnId);
  if (previousTurnId && previousTurnId !== eventTurnId) {
    // 换代不等于完成。旧回合后续的进展与终态均不能影响当前回合。
    if (scope.turnEnded) {
      settleNamedWork(scope.recentSettledTurnIds, previousTurnId);
    } else {
      settleNamedWork(scope.recentAbandonedTurnIds, previousTurnId);
    }
  }
  if (eventTurnId) {
    reopenNamedWork(scope.recentSettledTurnIds, eventTurnId);
    reopenNamedWork(scope.recentAbandonedTurnIds, eventTurnId);
  }
  scope.turnEnded = false;
  scope.turnEndedAt = undefined;
  scope.completionObserved = false;
  scope.completionObservedAt = undefined;
  scope.turnResetAt = at;
  scope.turnBoundaryAt = hookEventTimeMs(event, at);
  scope.terminalEvidence = undefined;
  scope.terminalEvidenceSource = undefined;
  // 默认非权威；只有 explicit-prompt 的 turn-start 才点亮。
  scope.currentTurnAuthoritative = false;
  clearActiveWork(scope);
  scope.currentTurnId = eventTurnId;
  scope.idleObservedAt = undefined;
  scope.mainProgressAt = hookEventTimeMs(event, at);
  scope.pendingMaintenance = undefined;
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
  subagentWorkId?: string,
  evidenceSource: AgentEventEvidenceSource = "hook"
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
    isStaleTurnEvent(scope, event, at) ||
    isStaleActivityIdle(scope, event, at)
  ) {
    return reject("stale-event");
  }
  const maintenance = applyMaintenanceObservation(scope, event, at);
  if (maintenance) return maintenance;
  if (
    canUnsealTranscriptTurn({
      at,
      event,
      eventTurnId,
      evidenceSource,
      scope,
    })
  ) {
    unsealTranscriptTurn(scope, event, at);
  }
  if (
    eventTurnId &&
    !isTerminalCorrection &&
    semantics.resetEvidence !== "explicit-prompt"
  ) {
    if (scope.recentSettledTurnIds.has(eventTurnId)) {
      return reject("settled-turn");
    }
    if (scope.recentAbandonedTurnIds.has(eventTurnId)) {
      return reject("abandoned-turn");
    }
  }
  if (
    eventTurnId &&
    scope.currentTurnId &&
    eventTurnId !== scope.currentTurnId &&
    !scope.turnEnded &&
    !scope.recentSettledTurnIds.has(scope.currentTurnId) &&
    semantics.resetEvidence !== "explicit-prompt" &&
    (scope.currentTurnAuthoritative ||
      semantics.category === "terminal-trusted")
  ) {
    // 工具/心跳不能抢占明确的主回合，终态更不能用外来身份认领活跃工作。
    // 已封账后显示方案问答时 turnEnded 可被清除，settled 身份仍允许续跑。
    return reject("foreign-turn");
  }
  if (semantics.category === "turn-start") {
    const decision = turnStartDecision(scope, semantics, eventTurnId);
    if (decision === "reset") {
      resetTurn(scope, event, at);
      if (semantics.resetEvidence === "explicit-prompt") {
        scope.currentTurnAuthoritative = true;
      }
      return { accepted: true, transition: "reset" };
    }
    if (semantics.resetEvidence === "explicit-prompt") {
      scope.currentTurnAuthoritative = true;
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
      resetTurn(scope, event, at);
      // 无显式提问的工作可以认领新回合；结束信号只能认领已结算后的续跑。
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
    scope.terminalEvidenceSource = undefined;
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
  scope.turnBoundaryAt ??= hookEventTimeMs(event, at);
  recordMainActivity(scope, event, at);
  if (semantics.category === "terminal-trusted") {
    const settledTurnId = eventTurnId ?? scope.currentTurnId;
    if (settledTurnId) {
      settleNamedWork(scope.recentSettledTurnIds, settledTurnId);
      scope.recentAbandonedTurnIds.delete(settledTurnId);
      scope.currentTurnId = settledTurnId;
    }
    scope.turnEnded = true;
    scope.turnEndedAt = at;
    scope.terminalEvidence = semantics.terminalEvidence;
    scope.terminalEvidenceSource = evidenceSource;
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
    // 候选没有结算权：主回合可能还在执行、等回答或等子智能体。
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
