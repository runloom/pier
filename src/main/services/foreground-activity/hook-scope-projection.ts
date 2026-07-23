import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
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
  // “已观察到完成但尚无可信终态”不能覆盖 error，也不能被旧 ready 掩盖。
  return status === undefined ? 1.5 : STATUS_PRIORITY[status];
}

function projectedScopeStatus(scope: HookScope): ActivityStatus | undefined {
  return scope.stale ? undefined : scope.status;
}

function isPanelFallbackScope(scope: HookScope): boolean {
  return scope.key === PANEL_HOOK_SCOPE_KEY;
}

/**
 * 已结算时刻：可信终态（turnEnded）或 advisory 完成候选（completionObserved
 * 且无具体 status）。供「settled session vs panel 噪声」判定。
 */
function scopeSettledAt(scope: HookScope): number | undefined {
  if (scope.stale) {
    return;
  }
  if (scope.turnEnded) {
    return scope.turnEndedAt;
  }
  if (scope.completionObserved && scope.status === undefined) {
    return scope.completionObservedAt;
  }
  return;
}

/**
 * 已结算的隔离 session 压过尚未开新回合的 panel 兜底 scope——修复 Cursor
 * 等 provider 在主会话 TurnCompleted 后，仍有无 sessionId 的迟到
 * preToolUse/postToolUse 把投影粘在 tool/processing 的假忙碌。
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
  const selectedStatus = projectedScopeStatus(selected);
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
      scope.status !== "ready" &&
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
          scope.status !== "ready" &&
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
