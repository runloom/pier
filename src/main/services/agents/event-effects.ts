import { isSubagentHookEvent } from "@shared/agent-session-actor.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";

export interface AgentEventEffects {
  observeTranscript: boolean;
  persistResume: boolean;
}

/**
 * 将已接受的 hook 事实规范化为面板级旁路效果。
 * 子会话只参与自身 scope 记账，不得覆盖父会话恢复信息。
 * SessionEnd 只结束会话；面板退出由原生终端进程事件确认。
 */
export function effectsForAcceptedAgentEvent(
  event: AgentHookEventPayload
): AgentEventEffects {
  const isSubagent = isSubagentHookEvent(event);
  return {
    observeTranscript: !isSubagent,
    persistResume: !isSubagent,
  };
}
