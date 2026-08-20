import { isSubagentHookEvent } from "@shared/agent-session-actor.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import {
  type AgentTurnEventSemantics,
  isGloballyUniqueTurnId,
  normalizeAgentTurnId,
} from "./agent-turn-event-semantics.ts";
import {
  type HookLayer,
  type HookScopeIdentity,
  PANEL_HOOK_SCOPE_KEY,
} from "./entry.ts";

const SESSION_SCOPE_PREFIX = "session:";

function sessionIdFromScopeKey(scopeKey: string): string | undefined {
  return scopeKey.startsWith(SESSION_SCOPE_PREFIX)
    ? scopeKey.slice(SESSION_SCOPE_PREFIX.length)
    : undefined;
}

export function claimTurn(
  hook: HookLayer,
  turnId: string | undefined,
  scopeKey: string
): void {
  const id = normalizeAgentTurnId(turnId);
  if (!(id && isGloballyUniqueTurnId(id))) {
    return;
  }
  const existing = hook.claimedTurns.get(id);
  if (existing && existing !== scopeKey && hook.scopes.has(existing)) {
    return;
  }
  hook.claimedTurns.set(id, scopeKey);
}

export function dropClaimedTurnsForScope(
  hook: HookLayer,
  scopeKey: string
): void {
  for (const [turnId, claimed] of hook.claimedTurns) {
    if (claimed === scopeKey) {
      hook.claimedTurns.delete(turnId);
    }
  }
}

/**
 * Cursor 等会把同一 generation 的 PromptSubmit/`stop` 与工具 hook 拆到两个
 * sessionId。PromptSubmit 认领账本后，后续同 turnId 事件并入该 scope，不再
 * 为错误 conversation 另开 ledger。
 *
 * 不改写 PromptSubmit（认领方保持自己的 session）、session 生灭、子会话。
 * processing/running 会并入已认领账本，但不得抢认领。
 * 短 turnId 不路由，避免进程级并行会话互相吞事件。
 */
export function bindEventToClaimedTurn(
  hook: HookLayer,
  event: AgentHookEventPayload,
  identity: HookScopeIdentity,
  semantics: AgentTurnEventSemantics
): { event: AgentHookEventPayload; identity: HookScopeIdentity } {
  if (isSubagentHookEvent(event)) {
    return { event, identity };
  }
  if (
    semantics.resetEvidence === "explicit-prompt" ||
    semantics.category === "session-start" ||
    semantics.category === "session-end"
  ) {
    return { event, identity };
  }
  const turnId = normalizeAgentTurnId(event.turnId);
  if (!(turnId && isGloballyUniqueTurnId(turnId))) {
    return { event, identity };
  }
  const ownerKey = hook.claimedTurns.get(turnId);
  if (!ownerKey || ownerKey === identity.key || !hook.scopes.has(ownerKey)) {
    return { event, identity };
  }
  const ownerSessionId = sessionIdFromScopeKey(ownerKey);
  return {
    event: ownerSessionId ? { ...event, sessionId: ownerSessionId } : event,
    identity: {
      isolated: ownerKey !== PANEL_HOOK_SCOPE_KEY,
      key: ownerKey,
      retainsPeerScopes: identity.retainsPeerScopes,
    },
  };
}
