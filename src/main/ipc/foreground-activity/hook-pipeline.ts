import { isSubagentHookEvent } from "@shared/agent-session-actor.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { createLogger } from "@shared/logger.ts";
import { effectsForAcceptedAgentEvent } from "../../services/agents/event-effects.ts";
import { resolveAgentEventIngestOptions } from "../../services/agents/integrations/runtime/event-authority.ts";
import type { AgentRuntimeSemantics } from "../../services/agents/integrations/types.ts";
import {
  agentEventTty,
  shouldRejectForeignTtyAgentEvent,
} from "../../services/foreground-activity/hook-event-origin.ts";
import type { ForegroundActivityAggregator } from "../../services/foreground-activity/types.ts";

const log = createLogger("foreground-activity.hook-pipeline");

/**
 * jsonl agentEvent 的消费装配：ctty 门必须先于全部支流（listener fanout /
 * resume 索引 / transcript 对账 / 状态聚合），被拒事件不得产生任何副作用。
 * 抽出为纯装配函数以便测试锁定该顺序契约。
 */
export interface AgentHookEventSinks {
  aggregator: Pick<
    ForegroundActivityAggregator,
    "ingestAgentEvent" | "panelCommandOwnedAgent"
  >;
  applySessionTitle: (routed: AgentHookEventPayload) => Promise<unknown>;
  markPanelExited: (args: {
    panelId: string;
    spawnGeneration?: number;
    windowId: string;
  }) => void;
  notifyListeners: (routed: AgentHookEventPayload) => void;
  observeTranscript:
    | ((routed: AgentHookEventPayload) => Promise<void>)
    | undefined;
  recordResume: (args: {
    agentId: AgentKind;
    panelId: string;
    sessionId: string | undefined;
    unlockRotation?: boolean | undefined;
    windowId: string;
  }) => void;
  resolveRuntime: (agent: AgentKind) => AgentRuntimeSemantics | undefined;
}

export async function handleObservedAgentHookEvent(
  sinks: AgentHookEventSinks,
  routed: AgentHookEventPayload
): Promise<void> {
  // ctty 门：挡「从 Pier 终端启动的 GUI（cursor . 开 IDE 等）继承
  // PIER_* env 后，IDE 内 agent 经共享 hook 冒充面板事件」。
  const foreignTty = shouldRejectForeignTtyAgentEvent({
    eventAgent: routed.agent,
    eventTty: agentEventTty(routed),
    oscOwnedAgent: sinks.aggregator.panelCommandOwnedAgent(
      routed.panelId,
      routed.windowId
    ),
  });
  if (foreignTty) {
    log.debug("agent hook event dropped: no controlling terminal", {
      agent: routed.agent,
      event: routed.event,
      panelId: routed.panelId,
    });
    return;
  }
  sinks.notifyListeners(routed);
  const options = resolveAgentEventIngestOptions({
    evidenceSource: "hook",
    event: routed,
    runtime: sinks.resolveRuntime(routed.agent),
  });
  // Resume index must not depend on FA turn bookkeeping accept: dropped
  // tool/progress events still carry the only host-side restore key.
  const effects = effectsForAcceptedAgentEvent(routed);
  if (effects.persistResume) {
    sinks.recordResume({
      agentId: routed.agent,
      panelId: routed.panelId,
      sessionId: routed.sessionId,
      windowId: routed.windowId,
      ...(routed.event === "PromptSubmit" ? { unlockRotation: true } : {}),
    });
  }
  const observe = effects.observeTranscript
    ? sinks.observeTranscript?.(routed)
    : undefined;
  if (observe && routed.event === "PromptSubmit") {
    try {
      await observe;
    } catch (err) {
      log.warn("agent terminal reconciliation failed", { err });
    }
  } else if (observe) {
    observe.catch((err: unknown) => {
      log.warn("agent terminal reconciliation failed", { err });
    });
  }
  const accepted = sinks.aggregator.ingestAgentEvent(routed, options);
  if (!accepted) {
    return;
  }
  if (effects.markPanelExited) {
    sinks.markPanelExited({
      panelId: routed.panelId,
      windowId: routed.windowId,
      ...("spawnGeneration" in routed && routed.spawnGeneration
        ? { spawnGeneration: routed.spawnGeneration }
        : {}),
    });
  }
  if (!isSubagentHookEvent(routed)) {
    sinks.applySessionTitle(routed).catch((err: unknown) => {
      log.warn("agent session title effect failed", { err });
    });
  }
}
