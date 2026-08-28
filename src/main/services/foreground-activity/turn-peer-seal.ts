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
 * 主回合可信终态时封掉同面板的对侧账本。两类对侧：
 *
 * 1. 同 turnId 分裂——工具事件先于 PromptSubmit 落到错误 session。
 *    主路径应走 claimed-turns，这里是防御扇出；只关联全局唯一 turnId，
 *    空 turnId 回退 origin.currentTurnId。
 * 2. 从未见过 PromptSubmit 的衍生 scope——实测（2026-08-26 events.jsonl）
 *    Cursor 子智能体是独立 conversation：只发 preToolUse/postToolUse，
 *    conversation_id === generation_id（退化 id），永远没有 stop/收口。
 *    该 scope 停在 processing 会压过主会话 ready 直到 TTL。主会话（见过
 *    显式提问的 origin）收口时一并封账；见过提问的并行会话（opencode/amp
 *    多线程）不受影响。
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
  const originPrompted = input.originScope.sawExplicitPrompt;
  for (const peer of input.hook.scopes.values()) {
    if (peer === input.originScope) {
      continue;
    }
    const sameTurn =
      turnId !== undefined &&
      normalizeAgentTurnId(peer.currentTurnId) === turnId;
    const promptlessDerivative = originPrompted && !peer.sawExplicitPrompt;
    if (!(sameTurn || promptlessDerivative)) {
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
