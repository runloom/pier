import type {
  AgentRuntimeFocusResult,
  SortAgentIndexEntriesOptions,
} from "@shared/contracts/agent-runtime-index.ts";
import i18next from "i18next";
import { toast } from "sonner";
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
    await showAppAlert({
      body: err instanceof Error ? err.message : String(err),
      title: i18next.t("agents.focusFailed"),
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
