/**
 * 未决交互注册表（M1 审批回写 agent.attention.respond）。
 *
 * 事件源：agent hook v3 的 InteractionRequested / InteractionResolved。
 * 注册挂在 services/foreground-activity/agent-hook-event-fanout
 * （onAgentHookEvent）上——JSONL hook
 * 行与 transcript reconciler 合成事件共用该 fan-out，reconciled-only
 * agent（codex 等）的交互事件因此同样进注册表；agentRef 由订阅侧用
 * makeAgentRef(windowId, panelId) 组装（pendingInteractionListener）。
 *
 * 消费方：
 * - agent.attention.respond 双重门之一（assertCurrent）；
 * - control.snapshot activity 摘要注入（currentInteractionId）。
 */
import { makeAgentRef } from "@shared/contracts/agent/runtime-index.ts";
import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV3,
} from "@shared/contracts/agent/session.ts";

export interface PendingInteractionRegistry {
  /** 无记录或不符 → false。 */
  assertCurrent(agentRef: string, interactionId: string): boolean;
  /** 当前登记的 interactionId；无登记 → undefined。 */
  currentInteractionId(agentRef: string): string | undefined;
  /**
   * InteractionRequested 且带 interactionId → 登记（同 agentRef 新
   * Requested 覆盖旧记录）；InteractionResolved → 清除。
   * 其他事件忽略。
   */
  onHookEvent(event: AgentHookEventPayloadV3, agentRef: string): void;
}

/**
 * 事件流订阅接线：严格 v3 agentEvent 且按 windowId/panelId 组装 agentRef
 * 后登记/清除。挂到 services/foreground-activity/
 * agent-hook-event-fanout 的 onAgentHookEvent——JSONL
 * hook 行与 reconciler 合成事件共用该 fan-out，两条路径进同一注册表实例。
 */
export function pendingInteractionListener(
  registry: PendingInteractionRegistry
): (event: AgentHookEventPayload) => void {
  return (event) => {
    if (event.kind !== "agentEvent" || event.v !== 3) {
      return;
    }
    registry.onHookEvent(event, makeAgentRef(event.windowId, event.panelId));
  };
}

export function createPendingInteractionRegistry(): PendingInteractionRegistry {
  const pendingByAgentRef = new Map<string, string>();
  return {
    onHookEvent(event, agentRef) {
      if (event.event === "InteractionRequested") {
        if (event.interactionId) {
          pendingByAgentRef.set(agentRef, event.interactionId);
        }
        return;
      }
      if (event.event === "InteractionResolved") {
        const current = pendingByAgentRef.get(agentRef);
        if (current === undefined) {
          return;
        }
        // id 匹配才清对应登记；无 id 的 Resolved 清该 agent 当前记录
        //（producer 不保证回填 id）；id 不符属乱序/陈旧 Resolved，不得
        // 误清当前未决项。
        if (
          event.interactionId === undefined ||
          event.interactionId === current
        ) {
          pendingByAgentRef.delete(agentRef);
        }
      }
    },
    assertCurrent(agentRef, interactionId) {
      return pendingByAgentRef.get(agentRef) === interactionId;
    },
    currentInteractionId(agentRef) {
      return pendingByAgentRef.get(agentRef);
    },
  };
}
