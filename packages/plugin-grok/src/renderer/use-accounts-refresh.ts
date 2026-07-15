import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { useCallback, useRef, useState } from "react";
import type { Translate } from "./format-account-error.ts";

export function useAccountsRefresh(options: {
  context: ExternalRendererPluginContext;
  onAccountError: (error: unknown) => void;
  t: Translate;
}): {
  refreshAllUsage: (accountIds: readonly string[]) => void;
  refreshUsage: (accountId?: string) => void;
  refreshingAccountIds: Set<string>;
  refreshingAll: boolean;
} {
  const { context, onAccountError, t } = options;
  const [refreshingAccountIds, setRefreshingAccountIds] = useState(
    () => new Set<string>()
  );
  const [refreshingAll, setRefreshingAll] = useState(false);
  const allGeneration = useRef(0);
  const refreshingAllRef = useRef(false);

  const refreshUsage = useCallback(
    (accountId?: string) => {
      if (refreshingAllRef.current) return;
      const key = accountId ?? "__active__";
      setRefreshingAccountIds((current) => {
        const next = new Set(current);
        next.add(key);
        return next;
      });
      context.rpc
        .invoke("accounts.refreshUsage", {
          ...(accountId ? { accountId } : {}),
          force: true,
        })
        .then(() => {
          context.notifications.success(
            t(
              "pier.grok.accounts.settings.usageRefreshSuccess",
              "Usage refreshed"
            )
          );
        })
        .catch(onAccountError)
        .finally(() => {
          setRefreshingAccountIds((current) => {
            if (refreshingAllRef.current) return current;
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        });
    },
    [context, onAccountError, t]
  );

  const refreshAllUsage = useCallback(
    (accountIds: readonly string[]) => {
      const generation = ++allGeneration.current;
      refreshingAllRef.current = true;
      setRefreshingAll(true);
      setRefreshingAccountIds(new Set(accountIds));
      context.rpc
        .invoke("accounts.refreshAllUsage", null)
        .then(() => {
          if (generation !== allGeneration.current) return;
          context.notifications.success(
            t(
              "pier.grok.accounts.settings.usageRefreshAllSuccess",
              "All account usage refreshed"
            )
          );
        })
        .catch((error: unknown) => {
          if (generation === allGeneration.current) onAccountError(error);
        })
        .finally(() => {
          if (generation !== allGeneration.current) return;
          refreshingAllRef.current = false;
          setRefreshingAll(false);
          setRefreshingAccountIds(new Set());
        });
    },
    [context, onAccountError, t]
  );

  return {
    refreshAllUsage,
    refreshUsage,
    refreshingAccountIds,
    refreshingAll,
  };
}
