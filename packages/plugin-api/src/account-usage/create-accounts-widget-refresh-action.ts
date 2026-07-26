import type { ComponentType } from "react";
import type {
  ExternalRendererPluginContext,
  RendererWorkbenchWidgetAction,
  WorkbenchWidgetActionContext,
} from "../renderer.ts";
import {
  type AccountUsageTranslate,
  isNoActiveAccountError,
  refreshAccountUsage,
} from "./refresh-account-usage.ts";

export interface AccountsWidgetRefreshActionI18n {
  label: { fallback: string; key: string };
  /** Body when requireActiveAccount fails (no success toast). */
  noActiveAccountBody: { fallback: string; key: string };
  refreshFailedTitle: { fallback: string; key: string };
  refreshSuccess: { fallback: string; key: string };
}

/**
 * Workbench accounts-widget header refresh action.
 *
 * Uses the same {@link refreshAccountUsage} path as the settings page hook
 * (`force: true`, active-account guard) so settings and workbench **manual**
 * refresh stay aligned. (Automatic polling is a separate lease/scheduler path.)
 */
export function createAccountsWidgetRefreshAction(options: {
  context: ExternalRendererPluginContext;
  icon: ComponentType<{ size?: number | string }>;
  i18n: AccountsWidgetRefreshActionI18n;
  /** Default 50 — sits with other primary widget actions. */
  priority?: number;
  t?: AccountUsageTranslate;
}): RendererWorkbenchWidgetAction {
  const { context, icon, i18n, priority = 50 } = options;
  const t: AccountUsageTranslate =
    options.t ?? ((key, fallback) => context.i18n.t(key, fallback));

  return {
    icon,
    id: "refresh",
    async invoke(actionContext: WorkbenchWidgetActionContext): Promise<void> {
      try {
        await refreshAccountUsage(context, { requireActiveAccount: true });
        // Host bulk refresh shows one summary toast; skip per-card success.
        if (!actionContext.bulkRefresh) {
          context.notifications.success(
            t(i18n.refreshSuccess.key, i18n.refreshSuccess.fallback)
          );
        }
      } catch (err) {
        let body: string;
        if (isNoActiveAccountError(err)) {
          body = t(
            i18n.noActiveAccountBody.key,
            i18n.noActiveAccountBody.fallback
          );
        } else if (err instanceof Error) {
          body = err.message;
        } else {
          body = String(err);
        }
        // Bulk path: rethrow so the host can aggregate failures into one alert.
        if (actionContext.bulkRefresh) {
          throw new Error(body);
        }
        // Swallow alert host failures so a second workbench "action failed"
        // dialog is not stacked on top (settings reportError does the same).
        await context.dialogs
          .alert({
            body,
            title: t(
              i18n.refreshFailedTitle.key,
              i18n.refreshFailedTitle.fallback
            ),
          })
          .catch(() => undefined);
      }
    },
    label: () => t(i18n.label.key, i18n.label.fallback),
    priority,
  };
}
