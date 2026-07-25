import i18next from "i18next";
import { useEffect } from "react";
import { reportAgentRuntimeFocusResult } from "@/lib/agent-runtime/focus-feedback.ts";
import { systemNotify } from "@/lib/notifications/system-notify.ts";
import { initAgentRuntimeIndexBridge } from "@/stores/agent-runtime-index.store.ts";

/**
 * Agent Runtime Index 桥 — 不渲染 UI。
 * 订阅 Index changed + 启动 list 兜底；focus-feedback；Attention 降级提示。
 * 勿改挂本窗 FA onChanged（双通道纪律）。
 */
export function AgentRuntimeIndexBridge(): null {
  useEffect(() => {
    const { dispose } = initAgentRuntimeIndexBridge();
    return dispose;
  }, []);

  useEffect(
    () =>
      window.pier.agentRuntimeIndex.onFocusFeedback((result) => {
        reportAgentRuntimeFocusResult(result);
      }),
    []
  );

  useEffect(() => {
    let toasted = false;
    return window.pier.agentRuntimeIndex.onAttentionDegraded(({ reason }) => {
      if (toasted) {
        return;
      }
      toasted = true;
      systemNotify({
        body: i18next.t(
          reason === "unsupported"
            ? "agents.notificationUnsupportedDetail"
            : "agents.notificationPermissionDeniedDetail"
        ),
        dedupeKey: `channel.health:attention-${reason}`,
        kind: "channel.health",
        severity: "info",
        titleKey:
          reason === "unsupported"
            ? "agents.notificationUnsupported"
            : "agents.notificationPermissionDenied",
      });
    });
  }, []);

  return null;
}
