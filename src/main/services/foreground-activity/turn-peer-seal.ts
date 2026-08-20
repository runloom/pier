import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import {
  type AgentTurnEventSemantics,
  isGloballyUniqueTurnId,
  normalizeAgentTurnId,
} from "./agent-turn-event-semantics.ts";
import type { HookLayer, HookScope } from "./entry.ts";
import { setHookScopeStatus } from "./hook-scope-projection.ts";
import { retireSubagentWorksForScope } from "./subagent-work-associations.ts";
import {
  applyTurnBookkeeping,
  nextStatusAfterTurnBookkeeping,
} from "./turn-bookkeeping.ts";

function sealTurnId(input: {
  event: AgentHookEventPayload;
  originScope: HookScope;
}): string | undefined {
  const fromEvent = normalizeAgentTurnId(input.event.turnId);
  const fromOrigin = normalizeAgentTurnId(input.originScope.currentTurnId);
  const turnId = fromEvent ?? fromOrigin;
  return turnId && isGloballyUniqueTurnId(turnId) ? turnId : undefined;
}

/**
 * 工具事件先于 PromptSubmit 落到错误 session 时的防御扇出。
 * 主路径应走 claimed-turns：同一 generation 只记一本账。
 * 只关联全局唯一 turnId；空 turnId 回退 origin.currentTurnId。
 */
export function sealMatchingTurnPeers(input: {
  at: number;
  event: AgentHookEventPayload;
  hook: HookLayer;
  originScope: HookScope;
  semantics: AgentTurnEventSemantics;
}): void {
  if (input.semantics.category !== "terminal-trusted") {
    return;
  }
  const turnId = sealTurnId(input);
  if (!turnId) {
    return;
  }
  for (const peer of input.hook.scopes.values()) {
    if (peer === input.originScope) {
      continue;
    }
    if (normalizeAgentTurnId(peer.currentTurnId) !== turnId) {
      continue;
    }
    const result = applyTurnBookkeeping(
      peer,
      input.event,
      input.semantics,
      input.at
    );
    if (!result.accepted) {
      continue;
    }
    setHookScopeStatus(
      input.hook,
      peer,
      nextStatusAfterTurnBookkeeping(peer, input.semantics),
      input.at
    );
    if (result.transition !== "none") {
      retireSubagentWorksForScope(input.hook, peer.key);
    }
  }
}
