import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { useRef, useState } from "react";
import type { Translate } from "./usage-meter.tsx";

/**
 * v1.2 起成本刷新走宿主 `window.pier.usageData.refreshAll()`（成本物料手动
 * 刷新入口）。本 hook 只剩账号/配额刷新，成本相关的 refreshCost/costRefreshing
 * 分支已删除。
 */
export function useAccountsRefresh(options: {
  context: ExternalRendererPluginContext;
  onAccountError: (error: unknown) => void;
  t: Translate;
}): {
  refreshingAccountIds: ReadonlySet<string>;
  refreshingAll: boolean;
  refreshAllUsage: (accountIds: readonly string[]) => Promise<void>;
  refreshUsage: (accountId: string) => Promise<void>;
} {
  const { context, onAccountError, t } = options;
  const [refreshingAccountIds, setRefreshingAccountIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [refreshingAll, setRefreshingAll] = useState(false);
  const allGeneration = useRef(0);

  const refreshUsage = async (accountId: string): Promise<void> => {
    if (refreshingAll) return;
    setRefreshingAccountIds((current) => new Set(current).add(accountId));
    try {
      await context.rpc.invoke("accounts.refreshUsage", { accountId });
      context.notifications.success(
        t("pier.codex.accounts.settings.usageRefreshSuccess", "Usage refreshed")
      );
    } catch (error) {
      onAccountError(error);
    } finally {
      setRefreshingAccountIds((current) => {
        if (refreshingAll) return current;
        const next = new Set(current);
        next.delete(accountId);
        return next;
      });
    }
  };

  const refreshAllUsage = async (
    accountIds: readonly string[]
  ): Promise<void> => {
    const generation = ++allGeneration.current;
    setRefreshingAll(true);
    setRefreshingAccountIds(new Set(accountIds));
    try {
      await context.rpc.invoke("accounts.refreshAllUsage", null);
      if (generation !== allGeneration.current) return;
      context.notifications.success(
        t(
          "pier.codex.accounts.settings.usageRefreshAllSuccess",
          "All account usage refreshed"
        )
      );
    } catch (error) {
      if (generation === allGeneration.current) onAccountError(error);
    } finally {
      if (generation === allGeneration.current) {
        setRefreshingAll(false);
        setRefreshingAccountIds(new Set());
      }
    }
  };

  return {
    refreshingAccountIds,
    refreshingAll,
    refreshAllUsage,
    refreshUsage,
  };
}
