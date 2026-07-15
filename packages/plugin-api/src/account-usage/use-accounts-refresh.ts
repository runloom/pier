import { useCallback, useRef, useState } from "react";
import type { ExternalRendererPluginContext } from "../renderer.ts";

export type AccountUsageTranslate = (key: string, fallback: string) => string;

export interface AccountsRefreshI18n {
  refreshAllSuccess: { fallback: string; key: string };
  refreshSuccess: { fallback: string; key: string };
}

/**
 * Shared settings/widget hook for accounts.refreshUsage / refreshAllUsage.
 * Manual actions always pass force: true so min-refetch cannot swallow clicks.
 */
export function useAccountsRefresh(options: {
  context: ExternalRendererPluginContext;
  i18n: AccountsRefreshI18n;
  onAccountError: (error: unknown) => void;
  t: AccountUsageTranslate;
}): {
  refreshAllUsage: (accountIds: readonly string[]) => void;
  refreshUsage: (accountId?: string) => void;
  refreshingAccountIds: ReadonlySet<string>;
  refreshingAll: boolean;
} {
  const { context, i18n, onAccountError, t } = options;
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
            t(i18n.refreshSuccess.key, i18n.refreshSuccess.fallback)
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
    [context, i18n.refreshSuccess, onAccountError, t]
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
            t(i18n.refreshAllSuccess.key, i18n.refreshAllSuccess.fallback)
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
    [context, i18n.refreshAllSuccess, onAccountError, t]
  );

  return {
    refreshAllUsage,
    refreshUsage,
    refreshingAccountIds,
    refreshingAll,
  };
}
