import type {
  ActivityStatus,
  AgentTurnResult,
} from "@shared/contracts/foreground-activity.ts";
import { statusWithNativeIdle } from "./activity-idle.ts";
import {
  HOOK_FRESH_TTL_MS,
  type HookLayer,
  type HookScope,
  PANEL_HOOK_SCOPE_KEY,
  type TimerCtx,
} from "./entry.ts";

const STATUS_PRIORITY: Record<ActivityStatus, number> = {
  error: 2,
  processing: 3,
  ready: 1,
  tool: 4,
  waiting: 5,
};

function statusPriority(status: ActivityStatus | undefined): number {
  // 尚无状态证据的会话不能覆盖已知活动或 error，也不能被旧 ready 掩盖。
  return status === undefined ? 1.5 : STATUS_PRIORITY[status];
}

function projectedScopeStatus(scope: HookScope): ActivityStatus | undefined {
  return scope.stale ? undefined : statusWithNativeIdle(scope, scope.status);
}

function projectedTurnResult(scope: HookScope): AgentTurnResult | undefined {
  if (!scope.turnEnded || scope.stale) return;
  switch (scope.terminalEvidence) {
    case "error":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "ready":
      return "completed";
    default:
      return;
  }
}

function isPanelFallbackScope(scope: HookScope): boolean {
  return scope.key === PANEL_HOOK_SCOPE_KEY;
}

/** 只有可信终态才有权让已结算 session 压过 panel 兜底工作。 */
function scopeSettledAt(scope: HookScope): number | undefined {
  if (scope.stale) {
    return;
  }
  if (scope.turnEnded) {
    return scope.turnEndedAt;
  }
  return;
}

/**
 * 已结算的隔离 session 压过尚未开新回合的 panel 兜底 scope——修复 Cursor
 * 等 provider 在主会话 TurnCompleted 后，仍有无 sessionId 的迟到
 * preToolUse/postToolUse 把投影粘在 tool/processing 的假忙碌。
 * 同 turnId、不同 sessionId 的分裂（工具 hook 与 stop 会话号不一致），以及
 * 工具事件先到另一 conversation 的同回合工作，由 `sealMatchingTurnPeers`
 * 在可信终态时按全局唯一 turnId 一并封账。
 * panel 若在结算之后收到 PromptSubmit 等回合重置，则仍可覆盖（新回合开始）。
 */
function preferredScope(current: HookScope, candidate: HookScope): HookScope {
  const currentSettledAt = scopeSettledAt(current);
  const candidateSettledAt = scopeSettledAt(candidate);
  if (
    currentSettledAt !== undefined &&
    !isPanelFallbackScope(current) &&
    isPanelFallbackScope(candidate) &&
    (candidate.turnResetAt ?? 0) <= currentSettledAt
  ) {
    return current;
  }
  if (
    candidateSettledAt !== undefined &&
    !isPanelFallbackScope(candidate) &&
    isPanelFallbackScope(current) &&
    (current.turnResetAt ?? 0) <= candidateSettledAt
  ) {
    return candidate;
  }
  const currentPriority = statusPriority(projectedScopeStatus(current));
  const candidatePriority = statusPriority(projectedScopeStatus(candidate));
  if (candidatePriority !== currentPriority) {
    return candidatePriority > currentPriority ? candidate : current;
  }
  return candidate.updatedAt >= current.updatedAt ? candidate : current;
}

export function refreshHookProjection(hook: HookLayer, at?: number): void {
  let selected: HookScope | null = null;
  let maxUpdatedAt = hook.updatedAt;
  let subagentCount = 0;
  for (const scope of hook.scopes.values()) {
    selected = selected ? preferredScope(selected, scope) : scope;
    maxUpdatedAt = Math.max(maxUpdatedAt, scope.updatedAt);
    subagentCount +=
      scope.activeSubagentIds.size + scope.anonymousSubagentCount;
  }
  if (!selected) {
    return;
  }
  hook.identity = { ...selected.identity };
  const selectedStatus = projectedScopeStatus(selected);
  hook.turnResult = projectedTurnResult(selected);
  const previousStatus = hook.status;
  hook.status = selectedStatus;
  if (selectedStatus === undefined) {
    hook.stateStartedAt = undefined;
  } else if (selectedStatus !== previousStatus) {
    hook.stateStartedAt = at ?? selected.stateStartedAt;
  }
  hook.subagentCount = subagentCount;
  hook.updatedAt = Math.max(maxUpdatedAt, at ?? 0);
}

export function setHookScopeStatus(
  hook: HookLayer,
  scope: HookScope,
  status: ActivityStatus | undefined,
  at: number
): void {
  if (scope.status !== status) {
    scope.status = status;
    scope.stateStartedAt = at;
  }
  scope.stale = false;
  scope.updatedAt = at;
  refreshHookProjection(hook, at);
}

/** hook 静默后只失去具体状态置信度，不得凭超时伪造 ready。 */
export function armHookTtlTimer(key: string, ctx: TimerCtx): void {
  const hook = ctx.slots.get(key)?.hook;
  if (!hook) {
    return;
  }
  if (hook.ttlTimer) {
    clearTimeout(hook.ttlTimer);
    hook.ttlTimer = null;
  }
  const expiringScopes = [...hook.scopes.values()].filter(
    (scope) =>
      !(scope.turnEnded || scope.stale) &&
      scope.status !== undefined &&
      projectedScopeStatus(scope) !== "ready" &&
      scope.status !== "error"
  );
  if (expiringScopes.length === 0) {
    return;
  }
  const nextExpiry = Math.min(
    ...expiringScopes.map((scope) => scope.updatedAt + HOOK_FRESH_TTL_MS)
  );
  hook.ttlTimer = setTimeout(
    () => {
      const current = ctx.slots.get(key)?.hook;
      if (!current) {
        return;
      }
      current.ttlTimer = null;
      const at = ctx.now();
      let changed = false;
      for (const scope of current.scopes.values()) {
        if (
          !(scope.turnEnded || scope.stale) &&
          scope.status !== undefined &&
          projectedScopeStatus(scope) !== "ready" &&
          scope.status !== "error" &&
          at - scope.updatedAt >= HOOK_FRESH_TTL_MS
        ) {
          scope.stale = true;
          changed = true;
        }
      }
      if (changed) {
        refreshHookProjection(current);
        ctx.scheduleEmit();
      }
      armHookTtlTimer(key, ctx);
    },
    Math.max(0, nextExpiry - ctx.now())
  );
}
