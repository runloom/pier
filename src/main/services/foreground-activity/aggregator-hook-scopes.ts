import {
  isSubagentHookEvent,
  SUBAGENT_HOOK_EVENTS,
} from "@shared/agent-session-actor.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import {
  logAgentEventDropped,
  logAgentLifecycleEvidence,
  refreshHookProjectionWithLog,
  setHookScopeStatusWithLog,
} from "./aggregator-tracing.ts";
import {
  type HookLayer,
  type HookScope,
  type HookScopeIdentity,
  hookIdentityFacts,
  PANEL_HOOK_SCOPE_KEY,
  type PanelSlot,
  SESSION_END_COOLDOWN_MS,
  TURN_BOUNDARY_EVENTS,
  TURN_RESET_EVENTS,
} from "./entry.ts";
import {
  commitSubagentWorkPlan,
  lookupSubagentScopeAssociations,
  planSubagentWork,
  retireSubagentWorksForScope,
} from "./subagent-work-associations.ts";
import type { AgentStopAuthority } from "./types.ts";

function updateSubagentAssociationsAfterBookkeeping(
  hook: HookLayer,
  scope: HookScope,
  event: AgentHookEventPayload,
  identity: HookScopeIdentity
): void {
  if (
    TURN_BOUNDARY_EVENTS.has(event.event) ||
    TURN_RESET_EVENTS.has(event.event) ||
    event.event === "Stop" ||
    event.event === "SessionEnd"
  ) {
    retireSubagentWorksForScope(hook, scope.key);
  }
  if (SUBAGENT_HOOK_EVENTS.has(event.event)) {
    commitSubagentWorkPlan(hook, scope, identity.subagentWorkPlan);
  }
}

export function isInCooldown(
  map: Map<string, number>,
  key: string,
  now: () => number
): boolean {
  const until = map.get(key);
  if (until === undefined) {
    return false;
  }
  if (now() >= until) {
    map.delete(key);
    return false;
  }
  return true;
}

interface HookScopeCoordinatorOpts {
  endHookSession: (key: string) => void;
  hookCooldownUntil: Map<string, number>;
  now: () => number;
  panelCooldownUntil: Map<string, number>;
  scheduleEmit: () => void;
  slots: Map<string, PanelSlot>;
}

export interface HookScopeCoordinator {
  allowsAgentEventAfterCooldowns: (
    key: string,
    event: AgentHookEventPayload,
    identity: HookScopeIdentity
  ) => boolean;
  clearCooldownsForPanel: (panelId: string) => void;
  handleSessionEnd: (
    key: string,
    event: AgentHookEventPayload,
    identity: HookScopeIdentity
  ) => boolean | null;
  noteStatusEvent: (
    key: string,
    hook: HookLayer,
    scope: HookScope,
    identity: HookScopeIdentity,
    event: AgentHookEventPayload,
    status: ActivityStatus | undefined,
    at: number,
    stopAuthority: AgentStopAuthority
  ) => void;
  prepareSessionStartScope: (
    hook: HookLayer,
    event: AgentHookEventPayload,
    identity: HookScopeIdentity
  ) => boolean;
  pruneExpiredCooldowns: () => void;
  resolveEventIdentity: (
    hook: HookLayer | null,
    event: AgentHookEventPayload,
    identity: HookScopeIdentity
  ) => HookScopeIdentity | null;
}

function identityForExistingScope(
  scopeKey: string,
  identity: HookScopeIdentity
): HookScopeIdentity {
  return {
    isolated: scopeKey !== PANEL_HOOK_SCOPE_KEY,
    key: scopeKey,
    retainsPeerScopes: identity.retainsPeerScopes,
  };
}

export function createHookScopeCoordinator({
  endHookSession,
  hookCooldownUntil,
  now,
  panelCooldownUntil,
  scheduleEmit,
  slots,
}: HookScopeCoordinatorOpts): HookScopeCoordinator {
  const hookScopeCooldownUntil = new Map<string, number>();

  function scopeCooldownKey(panelId: string, scopeKey: string): string {
    return `${panelId}\0${scopeKey}`;
  }

  function clearCooldownsForPanel(panelId: string): void {
    const prefix = `${panelId}\0`;
    for (const key of hookScopeCooldownUntil.keys()) {
      if (key.startsWith(prefix)) {
        hookScopeCooldownUntil.delete(key);
      }
    }
  }

  function pruneExpiredCooldowns(): void {
    for (const [id, until] of hookScopeCooldownUntil) {
      if (now() >= until) {
        hookScopeCooldownUntil.delete(id);
      }
    }
  }

  function endHookScope(
    key: string,
    scopeKey: string,
    agent: AgentHookEventPayload["agent"]
  ): boolean {
    const cooldownKey = scopeCooldownKey(key, scopeKey);
    hookScopeCooldownUntil.set(cooldownKey, now() + SESSION_END_COOLDOWN_MS);
    const hook = slots.get(key)?.hook ?? null;
    if (!hook?.scopes.has(scopeKey)) {
      return false;
    }
    retireSubagentWorksForScope(hook, scopeKey);
    hook.scopes.delete(scopeKey);
    if (hook.scopes.size === 0) {
      endHookSession(key);
      return true;
    }
    refreshHookProjectionWithLog(key, hook, now(), agent);
    scheduleEmit();
    return true;
  }

  function allowsAgentEventAfterCooldowns(
    key: string,
    event: AgentHookEventPayload,
    identity: HookScopeIdentity
  ): boolean {
    if (isInCooldown(panelCooldownUntil, key, now)) {
      logAgentEventDropped("suppressed-panel-cooldown", key, event.event);
      return false;
    }
    if (event.event === "SessionStart") {
      hookCooldownUntil.delete(key);
      if (identity.isolated) {
        hookScopeCooldownUntil.delete(scopeCooldownKey(key, identity.key));
      }
      return true;
    }
    if (isInCooldown(hookCooldownUntil, key, now)) {
      logAgentEventDropped("suppressed-hook-cooldown", key, event.event);
      return false;
    }
    if (
      identity.isolated &&
      isInCooldown(
        hookScopeCooldownUntil,
        scopeCooldownKey(key, identity.key),
        now
      )
    ) {
      logAgentEventDropped("suppressed-hook-cooldown", key, event.event);
      return false;
    }
    return true;
  }

  function handleSessionEnd(
    key: string,
    event: AgentHookEventPayload,
    identity: HookScopeIdentity
  ): boolean | null {
    if (event.event !== "SessionEnd") {
      return null;
    }
    if (isSubagentHookEvent(event)) {
      return false;
    }
    if (identity.isolated) {
      return endHookScope(key, identity.key, event.agent);
    }
    endHookSession(key);
    return true;
  }

  /**
   * 返回 true 表示同一具名 scope 的重复 SessionStart，调用方应保持幂等。
   * 非进程级提供方同一面板只允许一个主会话；新主会话会退休旧 scope。
   */
  function prepareSessionStartScope(
    hook: HookLayer,
    event: AgentHookEventPayload,
    identity: HookScopeIdentity
  ): boolean {
    if (event.event !== "SessionStart") {
      return false;
    }
    if (identity.isolated && hook.scopes.has(identity.key)) {
      return true;
    }
    if (!identity.retainsPeerScopes) {
      for (const scopeKey of hook.scopes.keys()) {
        retireSubagentWorksForScope(hook, scopeKey);
      }
      hook.scopes.clear();
    }
    return false;
  }

  function resolveEventIdentity(
    hook: HookLayer | null,
    event: AgentHookEventPayload,
    identity: HookScopeIdentity
  ): HookScopeIdentity | null {
    if (!(hook && SUBAGENT_HOOK_EVENTS.has(event.event))) {
      return identity;
    }

    const parentSessionId =
      "parentSessionId" in event ? event.parentSessionId?.trim() : undefined;
    let resolvedIdentity: HookScopeIdentity | null = null;
    if (parentSessionId) {
      const parentScopeKey = `session:${parentSessionId}`;
      if (hook.scopes.has(parentScopeKey)) {
        resolvedIdentity = identityForExistingScope(parentScopeKey, identity);
      } else {
        return null;
      }
    } else {
      const association = lookupSubagentScopeAssociations(hook, event);
      if (association.scopeKeys.size === 1) {
        const scopeKey = association.scopeKeys.values().next().value;
        if (!scopeKey) {
          return null;
        }
        resolvedIdentity = identityForExistingScope(scopeKey, identity);
      } else if (
        association.scopeKeys.size > 1 ||
        (association.hasSettledAlias && event.event === "SubagentStop")
      ) {
        return null;
      }
      if (!resolvedIdentity) {
        const candidateScopes = [...hook.scopes.values()].filter(
          (scope) => scope.identity.actorHint !== "subagent"
        );
        if (candidateScopes.length !== 1) {
          return null;
        }
        const candidateScope = candidateScopes[0];
        if (!candidateScope) {
          return null;
        }
        resolvedIdentity = identityForExistingScope(
          candidateScope.key,
          identity
        );
      }
    }
    const scope = hook.scopes.get(resolvedIdentity.key);
    if (!scope) {
      return null;
    }
    const subagentWorkPlan = planSubagentWork(hook, scope, event);
    if (subagentWorkPlan === null) {
      return null;
    }
    return subagentWorkPlan
      ? { ...resolvedIdentity, subagentWorkPlan }
      : resolvedIdentity;
  }

  function noteStatusEvent(
    key: string,
    hook: HookLayer,
    scope: HookScope,
    identity: HookScopeIdentity,
    event: AgentHookEventPayload,
    status: ActivityStatus | undefined,
    at: number,
    stopAuthority: AgentStopAuthority
  ): void {
    hook.agentId = event.agent;
    updateSubagentAssociationsAfterBookkeeping(hook, scope, event, identity);
    // 身份只由主会话事件推进；子会话事件只记数，不得改写面板行身份。
    // SessionStart 是**换会话**：同一面板 resume / clear 后会话号会变，
    // 此时整体替换，否则旧 sessionId 残留成错误身份。其余事件按事实叠加。
    if (!isSubagentHookEvent(event)) {
      const facts = hookIdentityFacts(event);
      scope.identity =
        event.event === "SessionStart"
          ? facts
          : { ...scope.identity, ...facts };
    }
    if (SUBAGENT_HOOK_EVENTS.has(event.event)) {
      // 子智能体生命周期只拥有计数与时间事实。即使父 scope 已无可信状态
      // （advisory Stop 或 TTL stale），也不得借映射值恢复主会话状态，
      // 更不得通过 setHookScopeStatus 清除 stale。
      scope.updatedAt = at;
      refreshHookProjectionWithLog(key, hook, at, event.agent);
      return;
    }
    const previousStatus = hook.status;
    setHookScopeStatusWithLog(key, hook, scope, status, at, event.agent);
    logAgentLifecycleEvidence({
      agent: event.agent,
      authority: stopAuthority,
      event: event.event,
      panelId: key,
      previousStatus,
      projectedStatus: hook.status,
      sessionId: event.sessionId,
      turnId: event.turnId,
    });
  }

  return {
    allowsAgentEventAfterCooldowns,
    clearCooldownsForPanel,
    handleSessionEnd,
    noteStatusEvent,
    prepareSessionStartScope,
    pruneExpiredCooldowns,
    resolveEventIdentity,
  };
}
