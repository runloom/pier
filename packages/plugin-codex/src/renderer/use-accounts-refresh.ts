import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { useState } from "react";
import type { Translate } from "./usage-meter.tsx";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAccountsRefresh(options: {
  context: ExternalRendererPluginContext;
  onAccountError: (error: unknown) => void;
  t: Translate;
}): {
  costRefreshing: boolean;
  refreshCost: () => Promise<void>;
  refreshingAccountIds: ReadonlySet<string>;
  refreshUsage: (accountId: string) => Promise<void>;
} {
  const { context, onAccountError, t } = options;
  const [refreshingAccountIds, setRefreshingAccountIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [costRefreshing, setCostRefreshing] = useState(false);

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

  const refreshCost = async (): Promise<void> => {
    setCostRefreshing(true);
    try {
      await context.rpc.invoke("usage.refreshCost", null);
      context.notifications.success(
        t(
          "pier.codex.accounts.settings.costRefreshSuccess",
          "Cost data refreshed"
        )
      );
    } catch (error) {
      await context.dialogs.alert({
        body: errorMessage(error),
        title: t(
          "pier.codex.accounts.settings.costRefreshFailed",
          "Could not refresh cost data"
        ),
      });
    } finally {
      setCostRefreshing(false);
    }
  };

  return {
    costRefreshing,
    refreshCost,
    refreshingAccountIds,
    refreshUsage,
  };
}
