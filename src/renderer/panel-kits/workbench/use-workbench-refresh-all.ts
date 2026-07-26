import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import { useCallback } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import type { ResolvedWorkbenchWidget } from "./workbench-merge.ts";
import { refreshAllWorkbenchWidgets } from "./workbench-widget-refresh.ts";

/**
 * Host "Refresh all" for the workbench context menu: real action RPC / token
 * bumps with one success toast or one failure alert.
 */
export function useWorkbenchRefreshAll(options: {
  bumpRefreshTokens: (instanceIds: readonly string[]) => void;
  handleUpdateParams: (
    instanceId: string,
    patch: Record<string, JsonValue>
  ) => void;
  refreshOne: (instanceId: string) => void;
  widgets: readonly ResolvedWorkbenchWidget[];
}): () => void {
  const t = useT();
  const { bumpRefreshTokens, handleUpdateParams, refreshOne, widgets } =
    options;

  return useCallback(() => {
    if (widgets.length === 0) return;
    refreshAllWorkbenchWidgets({
      bumpTokens: bumpRefreshTokens,
      requestRefresh: refreshOne,
      updateParams: handleUpdateParams,
      widgets,
    })
      .then(async (result) => {
        const attempted = result.actionCount + result.tokenCount;
        if (attempted === 0) return;
        if (result.failed.length === 0) {
          toast.success(t("workbench.refreshAllSuccess"));
          return;
        }
        // Technical detail → one host alert (not toast description).
        await showAppAlert({
          body: result.failed
            .map((entry) => `${entry.title}: ${entry.error}`)
            .join("\n"),
          title: t("workbench.refreshAllFailed"),
        });
      })
      .catch(() => undefined);
  }, [bumpRefreshTokens, handleUpdateParams, refreshOne, t, widgets]);
}
