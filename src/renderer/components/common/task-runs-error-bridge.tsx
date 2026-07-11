import { useEffect, useRef } from "react";
import { useT } from "@/i18n/use-t.ts";
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
    showAppConfirm({
      body: error,
      cancelLabel: t("terminal.runtimeControl.stateUnavailableDismiss"),
      confirmLabel: t("terminal.runtimeControl.stateUnavailableRetry"),
      intent: "default",
      size: "default",
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
