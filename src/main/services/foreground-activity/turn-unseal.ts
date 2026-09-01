import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { normalizeAgentTurnId } from "./agent-turn-event-semantics.ts";
import type { HookScope } from "./entry.ts";
import type { AgentEventEvidenceSource } from "./types.ts";

/**
 * Hook 发射脚本写 epoch 纳秒（`date +%s%N`，约 1e18）；聚合器 `at` /
 * `turnEndedAt` 是 `Date.now()` 毫秒（约 1e12）。阈值以上按纳秒收下。
 */
const NS_TS_THRESHOLD = 1e14;

export function hookEventTimeMs(
  event: AgentHookEventPayload,
  at: number
): number {
  const ts = event.ts;
  if (typeof ts !== "number" || !Number.isFinite(ts)) {
    return at;
  }
  return ts > NS_TS_THRESHOLD ? Math.floor(ts / 1_000_000) : ts;
}

/**
 * transcript 软封可被同回合新鲜 hook ToolStart 解开；无回合身份的 hook
 * error 也可被空 turnId 的 hook ToolStart 解开（Kimi StopFailure 后继续
 * 跑工具、且不发 PromptSubmit）。有 turnId 的 hook 终态与 host 终态仍是
 * 硬封。ToolComplete 不解封。
 */
export function canUnsealTranscriptTurn(input: {
  at: number;
  event: AgentHookEventPayload;
  eventTurnId: string | undefined;
  evidenceSource: AgentEventEvidenceSource;
  scope: HookScope;
}): boolean {
  const { at, event, eventTurnId, evidenceSource, scope } = input;
  if (!scope.turnEnded) {
    return false;
  }
  if (evidenceSource !== "hook" || event.event !== "ToolStart") {
    return false;
  }
  // 只挡明确早于封账的旧进展；同时刻（测试同毫秒 ingest、无 ts 的新鲜 hook）放行。
  if (
    scope.turnEndedAt !== undefined &&
    hookEventTimeMs(event, at) < scope.turnEndedAt
  ) {
    return false;
  }
  if (scope.terminalEvidenceSource === "transcript") {
    return !(eventTurnId && eventTurnId !== scope.currentTurnId);
  }
  return (
    scope.terminalEvidenceSource === "hook" &&
    scope.terminalEvidence === "error" &&
    normalizeAgentTurnId(scope.currentTurnId) === undefined &&
    eventTurnId === undefined
  );
}

export function unsealTranscriptTurn(
  scope: HookScope,
  eventTurnId?: string
): void {
  const settledId = eventTurnId ?? scope.currentTurnId;
  if (settledId) {
    scope.recentSettledTurnIds.delete(settledId);
  }
  scope.completionObserved = false;
  scope.completionObservedAt = undefined;
  scope.terminalEvidence = undefined;
  scope.terminalEvidenceSource = undefined;
  scope.turnEnded = false;
  scope.turnEndedAt = undefined;
}
