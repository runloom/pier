import type { AgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import { AGENT_ATTENTION_KIND } from "@shared/contracts/agent-attention.ts";
import type { SystemNotificationRequest } from "@shared/contracts/notification.ts";
import { createLogger } from "@shared/logger.ts";
import { broadcastAgentRuntimeFocusFeedback } from "../../app-core/window-broadcasts.ts";

const log = createLogger("agent-attention.notification-click");

/**
 * 系统通知 click → Index.focus 的唯一实现（Attention 直调与 notification IPC 共用）。
 * 仅处理带 agentRef 且 kind 缺省或为 agent.attention 的请求。
 */
export async function focusAgentFromNotificationClick(
  index: AgentRuntimeIndexService,
  shown: SystemNotificationRequest
): Promise<void> {
  if (!shown.agentRef) {
    return;
  }
  if (shown.kind !== undefined && shown.kind !== AGENT_ATTENTION_KIND) {
    return;
  }
  try {
    const result = await index.focus(shown.agentRef);
    if (result.status === "ok") {
      return;
    }
    broadcastAgentRuntimeFocusFeedback(result);
  } catch (err) {
    log.error("focus from notification click failed", { err });
    broadcastAgentRuntimeFocusFeedback({
      message: err instanceof Error ? err.message : String(err),
      status: "error",
    });
  }
}
