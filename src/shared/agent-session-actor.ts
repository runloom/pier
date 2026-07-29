/**
 * 主会话 vs 子会话判据——**唯一实现**。
 *
 * 这条判据同时决定两件事：面板级旁路效果（是否标退出 / 是否写 resume）
 * 与面板行身份（sessionId / actorHint / parentSessionId 能否被推进）。
 * 两处一旦各写一份就会漂移，而漂移的后果是把子会话的会话号当成面板主会话
 * 的身份——那正是「身份必须确定」要防的事，所以判据只允许有一处。
 */

import type { AgentHookEventPayload } from "./contracts/agent-session.ts";

/** 子代理生命周期事件（只做计数，不改父状态）。 */
export const SUBAGENT_HOOK_EVENTS: ReadonlySet<string> = new Set([
  "SubagentStart",
  "SubagentStop",
]);

/**
 * 事件是否代表子会话：Subagent* 生命周期事件、显式 `actorHint: "subagent"`，
 * 或带父会话号。三者都是 provider 原样上报的事实，不做推断。
 */
export function isSubagentHookEvent(event: AgentHookEventPayload): boolean {
  if (SUBAGENT_HOOK_EVENTS.has(event.event)) {
    return true;
  }
  if ("actorHint" in event && event.actorHint === "subagent") {
    return true;
  }
  return "parentSessionId" in event && event.parentSessionId !== undefined;
}
