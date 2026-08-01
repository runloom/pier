import type {
  AgentRuntimeFocusResult,
  SortAgentIndexEntriesOptions,
} from "@shared/contracts/agent/runtime-index.ts";
import i18next from "i18next";
import { toast } from "sonner";
import { systemNotify } from "@/lib/notifications/system-notify.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

/**
 * Index focus / focusWaiting 结果的统一用户反馈。
 * `ok` 无 toast（面板激活即强反馈）。
 */
export function reportAgentRuntimeFocusResult(
  result: AgentRuntimeFocusResult
): void {
  switch (result.status) {
    case "ok":
      return;
    case "empty":
      toast(i18next.t("agents.focusEmpty"));
      return;
    case "panel_gone":
      toast.error(i18next.t("agents.focusPanelGone"));
      return;
    case "window_gone":
      toast.error(i18next.t("agents.focusWindowGone"));
      return;
    case "error":
      showAppAlert({
        body: result.message,
        title: i18next.t("agents.focusFailed"),
      }).catch(() => undefined);
      // 带技术详情的失败：dialog + 落消息中心供追溯（设计 §7.3）
      systemNotify({
        body: result.message,
        kind: "operation.result",
        severity: "error",
        suppressToast: true,
        titleKey: "agents.focusFailed",
      });
      return;
    default: {
      const _exhaustive: never = result;
      throw new Error(
        `unexpected focus result: ${JSON.stringify(_exhaustive)}`
      );
    }
  }
}

/** IPC 抛错也进同一失败族，禁止快捷键路径只 console.error。 */
export async function invokeAgentRuntimeFocus(
  run: () => Promise<AgentRuntimeFocusResult>
): Promise<void> {
  try {
    reportAgentRuntimeFocusResult(await run());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await showAppAlert({
      body: message,
      title: i18next.t("agents.focusFailed"),
    });
    // 与 result.status==="error" 同族：落消息中心供追溯（两条失败路径归档一致）
    systemNotify({
      body: message,
      kind: "operation.result",
      severity: "error",
      suppressToast: true,
      titleKey: "agents.focusFailed",
    });
  }
}

export async function invokeAgentRuntimeFocusWaiting(
  options?: SortAgentIndexEntriesOptions
): Promise<void> {
  await invokeAgentRuntimeFocus(() =>
    window.pier.agentRuntimeIndex.focusWaiting(options)
  );
}
