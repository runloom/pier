import { useCallback, useRef, useState } from "react";
import type { ExternalRendererPluginContext } from "../renderer.ts";
import {
  type AccountUsageTranslate,
  normalizeAccountId,
  refreshAccountUsage,
  refreshAllAccountUsage,
} from "./refresh.ts";

export interface AccountsRefreshI18n {
  refreshAllSuccess: { fallback: string; key: string };
  refreshSuccess: { fallback: string; key: string };
}

/**
 * Settings-page (and any React surface) hook for manual usage refresh.
 *
 * RPC body is owned by {@link refreshAccountUsage} /
 * {@link refreshAllAccountUsage} — the same functions workbench widget actions
 * call — so min-refetch / force / payload shape cannot diverge. This hook only
 * owns busy-state and toast / error plumbing.
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
      const normalizedId = normalizeAccountId(accountId);
      const key = normalizedId ?? "__active__";
      setRefreshingAccountIds((current) => {
        const next = new Set(current);
        next.add(key);
        return next;
      });
      refreshAccountUsage(
        context,
        normalizedId === undefined ? {} : { accountId: normalizedId }
      )
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
      refreshAllAccountUsage(context)
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
