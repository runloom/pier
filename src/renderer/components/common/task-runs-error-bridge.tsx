import { useEffect, useRef } from "react";
import { useT } from "@/i18n/use-t.ts";
import { systemNotify } from "@/lib/notifications/system-notify.ts";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import {
  initTaskRunsStore,
  useTaskRunsStore,
} from "@/stores/task-runs.store.ts";

/** 任务状态通道失败不能退化成“浮层消失”；提供可见错误和原地重试。 */
export function TaskRunsErrorBridge(): null {
  const t = useT();
  const error = useTaskRunsStore((state) => state.error);
  const presentedError = useRef<string | null>(null);

  useEffect(() => {
    if (!error || presentedError.current === error) {
      return;
    }
    presentedError.current = error;
    // 通道故障：confirm（重试/忽略）处理当下，消息中心留痕供事后回看。
    systemNotify({
      body: error,
      dedupeKey: "channel.health:task-runs",
      kind: "channel.health",
      severity: "error",
      suppressToast: true,
      titleKey: "terminal.runtimeControl.stateUnavailableTitle",
    });
    showAppConfirm({
      body: error,
      cancelLabel: t("terminal.runtimeControl.stateUnavailableDismiss"),
      confirmLabel: t("terminal.runtimeControl.stateUnavailableRetry"),
      intent: "default",
      title: t("terminal.runtimeControl.stateUnavailableTitle"),
    }).then((retry) => {
      if (retry) {
        presentedError.current = null;
        return initTaskRunsStore();
      }
      return;
    });
  }, [error, t]);

  return null;
}
