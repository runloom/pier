import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { normalizeAgentTurnId } from "./agent-turn-event-semantics.ts";
import type { HookScope } from "./entry.ts";
import type { TurnBookkeepingResult } from "./turn-bookkeeping.ts";
import { settleNamedWork } from "./turn-ledger.ts";
import { hookEventTimeMs } from "./turn-unseal.ts";

/**
 * 维护动作的原生 prompt ID 属于维护操作，不认领或结算用户回合。
 * Started 只登记关联；只有成对的手动 Completed 才提供当前空闲事实。
 */
export function applyMaintenanceObservation(
  scope: HookScope,
  event: AgentHookEventPayload,
  at: number
): TurnBookkeepingResult | undefined {
  if (
    event.event !== "MaintenanceStarted" &&
    event.event !== "MaintenanceCompleted"
  )
    return;
  const id = normalizeAgentTurnId(event.turnId);
  const time = hookEventTimeMs(event, at);
  if (time < (scope.mainProgressAt ?? 0))
    return { accepted: false, reason: "stale-event" };
  if (event.v === 1 || event.nativeState !== "manual") {
    return { accepted: true, transition: "observation" };
  }
  if (!id || scope.settledMaintenanceIds?.has(id)) {
    return { accepted: false, reason: "settled-turn" };
  }
  if (event.event === "MaintenanceStarted") {
    if (
      !scope.pendingMaintenance ||
      time >= scope.pendingMaintenance.startedAt
    ) {
      scope.pendingMaintenance = { id, startedAt: time };
    }
    return { accepted: true, transition: "observation" };
  }
  if (
    scope.pendingMaintenance?.id !== id ||
    time < scope.pendingMaintenance.startedAt
  ) {
    return { accepted: false, reason: "foreign-turn" };
  }
  scope.pendingMaintenance = undefined;
  scope.settledMaintenanceIds ??= new Set();
  settleNamedWork(scope.settledMaintenanceIds, id);
  scope.idleObservedAt = time;
  return { accepted: true, transition: "activity-idle" };
}
