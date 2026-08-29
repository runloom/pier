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
import {
  clearActiveWork,
  hookScopeHasActiveInteractions,
  hookScopeHasActiveTools,
  reopenNamedWork,
  settleNamedWork,
  type TerminalRetiredWork,
} from "./turn-ledger.ts";

export {
  hookScopeHasActiveInteractions,
  hookScopeHasActiveTools,
  type TerminalRetiredWork,
} from "./turn-ledger.ts";

export type TurnTransition =
  | "none"
  | "reset"
  | "terminal-candidate"
  | "terminal-trusted";

export type TurnBookkeepingRejectionReason =
  | "abandoned-turn"
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
    // 旧回合只是被抢占/换代抛弃，不等于已由可信终态结算：迟到进展仍然
    // 拒收（防 ping-pong），但迟到的可信终态可经 abandoned 分支封账。
    // 已被终态结算的回合（turnEnded 后开新回合）保持 settled 语义不动。
    if (scope.turnEnded) {
      settleNamedWork(scope.recentSettledTurnIds, previousTurnId);
      scope.lastDisplacedTurnId = undefined;
    } else {
      settleNamedWork(scope.recentAbandonedTurnIds, previousTurnId);
      scope.lastDisplacedTurnId = previousTurnId;
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
  scope.terminalEvidence = undefined;
  // 默认非权威；只有 explicit-prompt 的 turn-start 才点亮。
  scope.currentTurnAuthoritative = false;
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
    !isTerminalCorrection &&
    semantics.resetEvidence !== "explicit-prompt"
  ) {
    if (scope.recentSettledTurnIds.has(eventTurnId)) {
      return reject("settled-turn");
    }
    // 被抛弃回合：进展/候选一律拒收（防复活 ping-pong）。可信终态只放行
    // **最近一次被抢占**的那一格，且当前回合不是显式提问建立的——避免
    // Prompt A→B→泄漏 C 后迟到的 A 终态误封。correlatable 心跳不得点亮
    // 权威。已知取舍：Esc 后无 PromptSubmit 直接 ToolStart（方案 Build）
    // 与事故同形，迟到旧 stop 仍会封账；适配器层应阻止泄漏 turnId。
    const abandonedTerminalSeal =
      semantics.category === "terminal-trusted" &&
      !scope.turnEnded &&
      !scope.currentTurnAuthoritative &&
      eventTurnId === scope.lastDisplacedTurnId;
    if (
      scope.recentAbandonedTurnIds.has(eventTurnId) &&
      !abandonedTerminalSeal
    ) {
      return reject("abandoned-turn");
    }
  }
  if (semantics.category === "turn-start") {
    if (semantics.resetEvidence === "explicit-prompt") {
      scope.sawExplicitPrompt = true;
    }
    const decision = turnStartDecision(scope, semantics, eventTurnId);
    if (decision === "reset") {
      resetTurn(scope, eventTurnId, at);
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
      resetTurn(scope, eventTurnId, at);
      // 工具 work 事件认领的回合可能是泄漏的子智能体 generation，不算
      // 权威建立；可信终态认领后立即封账，标记值不参与后续判定。
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
      scope.recentAbandonedTurnIds.delete(settledTurnId);
      if (scope.lastDisplacedTurnId === settledTurnId) {
        scope.lastDisplacedTurnId = undefined;
      }
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
