import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import type { ActivityStatus } from "@shared/contracts/foreground-activity.ts";
import {
  logAgentEventDropped,
  refreshHookProjectionWithLog,
  setHookScopeStatusWithLog,
} from "./aggregator-tracing.ts";
import {
  type HookLayer,
  type HookScope,
  type HookScopeIdentity,
  type PanelSlot,
  SESSION_END_COOLDOWN_MS,
  SUBAGENT_EVENTS,
} from "./entry.ts";

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
    event: AgentHookEventPayload,
    status: ActivityStatus,
    at: number
  ) => void;
  pruneExpiredCooldowns: () => void;
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
    if (!hook?.scopes.delete(scopeKey)) {
      return false;
    }
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
    if (identity.isolated) {
      return endHookScope(key, identity.key, event.agent);
    }
    endHookSession(key);
    return true;
  }

  function noteStatusEvent(
    key: string,
    hook: HookLayer,
    scope: HookScope,
    event: AgentHookEventPayload,
    status: ActivityStatus,
    at: number
  ): void {
    hook.agentId = event.agent;
    if (SUBAGENT_EVENTS.has(event.event)) {
      scope.updatedAt = at;
      refreshHookProjectionWithLog(key, hook, at, event.agent);
      return;
    }
    setHookScopeStatusWithLog(key, hook, scope, status, at, event.agent);
  }

  return {
    allowsAgentEventAfterCooldowns,
    clearCooldownsForPanel,
    handleSessionEnd,
    noteStatusEvent,
    pruneExpiredCooldowns,
  };
}
