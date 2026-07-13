import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";

export interface AgentEventEffects {
  markPanelExited: boolean;
  observeTranscript: boolean;
  persistResume: boolean;
}

/**
 * 将已接受的 hook 事实规范化为面板级旁路效果。
 * 子会话只参与自身 scope 记账，不得覆盖父会话恢复信息或把整个面板标成退出。
 */
export function effectsForAcceptedAgentEvent(
  event: AgentHookEventPayload
): AgentEventEffects {
  const isSubagent =
    event.event === "SubagentStart" ||
    event.event === "SubagentStop" ||
    ("actorHint" in event && event.actorHint === "subagent") ||
    ("parentSessionId" in event && event.parentSessionId !== undefined);
  return {
    markPanelExited: !isSubagent && event.event === "SessionEnd",
    observeTranscript: !isSubagent,
    persistResume: !isSubagent,
  };
}
