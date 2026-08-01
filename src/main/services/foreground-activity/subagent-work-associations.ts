import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { HookLayer, HookScope } from "./entry.ts";

const MAX_SETTLED_SUBAGENT_WORKS = 256;

export interface SubagentWorkAssociation {
  aliases: Set<string>;
  id: string;
  scopeKey: string;
}

export interface SubagentWorkPlan {
  aliases: string[];
  id: string;
  operation: "start" | "stop";
}

interface SubagentAssociationLookup {
  activeIds: Set<string>;
  hasSettledAlias: boolean;
  scopeKeys: Set<string>;
}

export function subagentIdentityAliases(
  event: AgentHookEventPayload
): string[] {
  const aliases: string[] = [];
  const sessionId = event.sessionId?.trim();
  if (sessionId) {
    aliases.push(`session:${sessionId}`);
  }
  const agentInstanceId = event.agentInstanceId?.trim();
  if (agentInstanceId) {
    aliases.push(`instance:${agentInstanceId}`);
  }
  return aliases;
}

function lookupSubagentAssociations(
  hook: HookLayer,
  aliases: string[],
  scopeKey?: string
): SubagentAssociationLookup {
  const activeIds = new Set<string>();
  const scopeKeys = new Set<string>();
  let hasSettledAlias = false;
  for (const alias of aliases) {
    for (const id of hook.subagentWorkIdsByAlias.get(alias) ?? []) {
      const active = hook.activeSubagentWorks.get(id);
      if (active && (!scopeKey || active.scopeKey === scopeKey)) {
        activeIds.add(id);
        scopeKeys.add(active.scopeKey);
      } else {
        const settled = hook.settledSubagentWorks.get(id);
        if (settled && (!scopeKey || settled.scopeKey === scopeKey)) {
          hasSettledAlias = true;
        }
      }
    }
  }
  return { activeIds, hasSettledAlias, scopeKeys };
}

export function lookupSubagentScopeAssociations(
  hook: HookLayer,
  event: AgentHookEventPayload
): SubagentAssociationLookup {
  return lookupSubagentAssociations(hook, subagentIdentityAliases(event));
}

function nextSubagentWorkId(hook: HookLayer): string {
  hook.nextSubagentWorkId += 1;
  return `subagent-work:${hook.nextSubagentWorkId}`;
}

export function planSubagentWork(
  hook: HookLayer,
  scope: HookScope,
  event: AgentHookEventPayload
): SubagentWorkPlan | null | undefined {
  const aliases = subagentIdentityAliases(event);
  if (aliases.length === 0) {
    return;
  }
  const hasExplicitParent =
    "parentSessionId" in event && Boolean(event.parentSessionId?.trim());
  const lookup = lookupSubagentAssociations(
    hook,
    aliases,
    hasExplicitParent ? scope.key : undefined
  );
  if (lookup.activeIds.size > 1) {
    return null;
  }
  const [activeId] = lookup.activeIds;
  const active = activeId ? hook.activeSubagentWorks.get(activeId) : undefined;
  if (active && active.scopeKey !== scope.key) {
    const hasUnboundAlias = aliases.some((alias) =>
      [...(hook.subagentWorkIdsByAlias.get(alias) ?? [])].every(
        (id) => !hook.activeSubagentWorks.has(id)
      )
    );
    if (event.event !== "SubagentStart" || !hasUnboundAlias) {
      return null;
    }
    return {
      aliases,
      id: nextSubagentWorkId(hook),
      operation: "start",
    };
  }
  if (event.event === "SubagentStart") {
    return {
      aliases,
      id: active?.id ?? nextSubagentWorkId(hook),
      operation: "start",
    };
  }
  if (active) {
    return { aliases, id: active.id, operation: "stop" };
  }
  if (
    lookup.hasSettledAlias ||
    hook.subagentAssociationHistoryIncomplete ||
    scope.anonymousSubagentCount === 0
  ) {
    return null;
  }
  return {
    aliases,
    id: nextSubagentWorkId(hook),
    operation: "stop",
  };
}

function addAlias(hook: HookLayer, alias: string, id: string): void {
  let ids = hook.subagentWorkIdsByAlias.get(alias);
  if (!ids) {
    ids = new Set();
    hook.subagentWorkIdsByAlias.set(alias, ids);
  }
  ids.add(id);
}

function removeAlias(
  hook: HookLayer,
  association: SubagentWorkAssociation,
  alias: string
): void {
  association.aliases.delete(alias);
  const ids = hook.subagentWorkIdsByAlias.get(alias);
  ids?.delete(association.id);
  if (ids?.size === 0) {
    hook.subagentWorkIdsByAlias.delete(alias);
  }
}

function setCurrentAlias(
  hook: HookLayer,
  association: SubagentWorkAssociation,
  alias: string
): void {
  const kind = alias.slice(0, alias.indexOf(":"));
  for (const existing of [...association.aliases]) {
    if (existing !== alias && existing.startsWith(`${kind}:`)) {
      removeAlias(hook, association, existing);
      hook.subagentAssociationHistoryIncomplete = true;
    }
  }
  association.aliases.add(alias);
  addAlias(hook, alias, association.id);
}

function removeAssociationAliases(
  hook: HookLayer,
  association: SubagentWorkAssociation
): void {
  for (const alias of association.aliases) {
    const ids = hook.subagentWorkIdsByAlias.get(alias);
    ids?.delete(association.id);
    if (ids?.size === 0) {
      hook.subagentWorkIdsByAlias.delete(alias);
    }
  }
}

function retainSettledAssociation(
  hook: HookLayer,
  association: SubagentWorkAssociation
): void {
  hook.settledSubagentWorks.set(association.id, association);
  while (hook.settledSubagentWorks.size > MAX_SETTLED_SUBAGENT_WORKS) {
    const oldestId = hook.settledSubagentWorks.keys().next().value;
    if (oldestId === undefined) {
      break;
    }
    const oldest = hook.settledSubagentWorks.get(oldestId);
    hook.settledSubagentWorks.delete(oldestId);
    if (oldest) {
      removeAssociationAliases(hook, oldest);
    }
    hook.subagentAssociationHistoryIncomplete = true;
  }
}

export function commitSubagentWorkPlan(
  hook: HookLayer,
  scope: HookScope,
  plan: SubagentWorkPlan | undefined
): void {
  if (!plan) {
    return;
  }
  if (plan.operation === "start") {
    let association = hook.activeSubagentWorks.get(plan.id);
    if (!association) {
      association = { aliases: new Set(), id: plan.id, scopeKey: scope.key };
      hook.activeSubagentWorks.set(plan.id, association);
    }
    for (const alias of plan.aliases) {
      setCurrentAlias(hook, association, alias);
    }
    return;
  }
  const association = hook.activeSubagentWorks.get(plan.id) ?? {
    aliases: new Set<string>(),
    id: plan.id,
    scopeKey: scope.key,
  };
  hook.activeSubagentWorks.delete(plan.id);
  for (const alias of plan.aliases) {
    setCurrentAlias(hook, association, alias);
  }
  retainSettledAssociation(hook, association);
}

export function retireSubagentWorksForScope(
  hook: HookLayer,
  scopeKey: string
): void {
  for (const association of [...hook.activeSubagentWorks.values()]) {
    if (association.scopeKey !== scopeKey) {
      continue;
    }
    hook.activeSubagentWorks.delete(association.id);
    retainSettledAssociation(hook, association);
  }
}
