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
import type { AgentEventEvidenceSource } from "./types.ts";

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
 * 主回合可信终态只结算同一全局唯一 turnId 的对侧账本（工具 hook 先到另一
 * session 的兼容情况）。空终态回退 origin.currentTurnId。
 * 没见过 PromptSubmit 不是子会话证据，不能据此结算另一会话的工作。
 */
export function sealMatchingTurnPeers(input: {
  at: number;
  event: AgentHookEventPayload;
  evidenceSource: AgentEventEvidenceSource;
  hook: HookLayer;
  originScope: HookScope;
  semantics: AgentTurnEventSemantics;
}): void {
  if (input.semantics.category !== "terminal-trusted") {
    return;
  }
  const turnId = sealTurnId(input);
  for (const peer of input.hook.scopes.values()) {
    if (peer === input.originScope) {
      continue;
    }
    const sameTurn =
      turnId !== undefined &&
      normalizeAgentTurnId(peer.currentTurnId) === turnId;
    if (!sameTurn) {
      continue;
    }
    const result = applyTurnBookkeeping(
      peer,
      input.event,
      input.semantics,
      input.at,
      undefined,
      input.evidenceSource
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
    // 同前：只有换代才退休子工作关联，可信终态封账保留仍在跑的子工作。
    if (result.transition === "reset") {
      retireSubagentWorksForScope(input.hook, peer.key);
    }
  }
}
