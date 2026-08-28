/**
 * agentEvent 旁路 fan-out（listener 异常隔离）。两条事件路径共用同一
 * fan-out 点，保证旁路消费者（未决交互登记，M1 审批回写）只挂一处：
 * - JSONL hook 行主路径（owner 路由后）；
 * - transcript reconciler 合成的 v3 事件（codex/cursor/grok 的
 *   InteractionRequested/Resolved 只走这条路）。
 *
 * 同一合成事件不会被双路径重复投递：reconciler 输入来自 hook 行 observe，
 * 合成输出只经 onTerminalEvent；tail-event 已按
 * (turnId, pierEvent, interactionId) 去重。即便重复投递，注册表同
 * agentRef 覆盖语义幂等，id 不符的 Resolved 不会误清新登记。
 *
 * 注意：本 fan-out 在 isSubagentHookEvent 过滤之前触发（子代理 hook 行
 * 同样会登记到面板级 agentRef）——现状保留，见 task-8 修复报告。
 */
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { createLogger } from "@shared/logger.ts";

const log = createLogger("agent-hook-event-fanout");

const agentHookEventListeners = new Set<
  (event: AgentHookEventPayload) => void
>();

/**
 * 订阅 agentEvent 旁路流；返回退订函数。不改变 FA 聚合语义。
 */
export function onAgentHookEvent(
  listener: (event: AgentHookEventPayload) => void
): () => void {
  agentHookEventListeners.add(listener);
  return () => {
    agentHookEventListeners.delete(listener);
  };
}

/**
 * 向所有旁路 listener 投递事件。单个 listener 抛错不影响其余 listener
 * 与主路径。
 */
export function notifyAgentHookEventListeners(
  event: AgentHookEventPayload
): void {
  for (const listener of agentHookEventListeners) {
    try {
      listener(event);
    } catch (err) {
      log.warn("agent hook event listener failed", { err });
    }
  }
}
