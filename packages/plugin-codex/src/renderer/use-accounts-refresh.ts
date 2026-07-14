import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { useState } from "react";
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
  refreshUsage: (accountId: string) => Promise<void>;
} {
  const { context, onAccountError, t } = options;
  const [refreshingAccountIds, setRefreshingAccountIds] = useState<
    ReadonlySet<string>
  >(new Set());

  const refreshUsage = async (accountId: string): Promise<void> => {
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
        const next = new Set(current);
        next.delete(accountId);
        return next;
      });
    }
  };

  return {
    refreshingAccountIds,
    refreshUsage,
  };
}
