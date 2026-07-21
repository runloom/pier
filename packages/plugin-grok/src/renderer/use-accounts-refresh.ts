import { useAccountsRefresh as useSharedAccountsRefresh } from "@pier/plugin-api/account-usage/renderer";
import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import type { Translate } from "./format-account-error.ts";

export function useAccountsRefresh(options: {
  context: ExternalRendererPluginContext;
  onAccountError: (error: unknown) => void;
  t: Translate;
}): {
  refreshAllUsage: (accountIds: readonly string[]) => void;
  refreshUsage: (accountId?: string) => void;
  refreshingAccountIds: ReadonlySet<string>;
  refreshingAll: boolean;
} {
  return useSharedAccountsRefresh({
    context: options.context,
    i18n: {
      refreshAllSuccess: {
        fallback: "All usage refreshed",
        key: "pier.grok.accounts.settings.usageRefreshAllSuccess",
      },
      refreshSuccess: {
        fallback: "Usage refreshed",
        key: "pier.grok.accounts.settings.usageRefreshSuccess",
      },
    },
    onAccountError: options.onAccountError,
    t: options.t,
  });
}
