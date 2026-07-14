import type {
  ExternalRendererPluginContext,
  MissionControlWidgetActionContext,
  MissionControlWidgetComponentProps,
  RendererMissionControlWidgetAction,
} from "@pier/plugin-api/renderer";
import { Badge } from "@pier/ui/badge.tsx";
import { formatRelativeTime } from "@pier/ui/format.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { WidgetError, WidgetSkeleton } from "@pier/ui/widget-state.tsx";
import { RefreshCw } from "lucide-react";
import type { JSX } from "react";
import { AccountAvatar, resetCredits } from "./account-display.tsx";
import { AccountPicker } from "./account-picker.tsx";
import { UsageMeter } from "./usage-meter.tsx";
import { useCodexAccountsSnapshot } from "./use-accounts-snapshot.ts";
import { useUsagePollingLease } from "./use-usage-polling-lease.ts";

/**
 * Codex account and quota widget. The host owns the outer Card and title.
 *
 * Refresh flows through {@link accountsWidgetActions}: the async invoke keeps
 * the header refresh-button spinner spinning for the real IPC duration, and
 * the widget body doesn't render a separate spinner element (双 spinner 是错
 * 觉——同一动作有两个 loading 指示是 UX bug)。
 */

export interface AccountsWidgetProps
  extends MissionControlWidgetComponentProps {
  context: ExternalRendererPluginContext;
}

export function AccountsWidget({
  context,
  instanceId,
  size,
  visible,
}: AccountsWidgetProps): JSX.Element {
  const { error: loadError, snapshot } = useCodexAccountsSnapshot(context);
  const t = (key: string, fallback: string): string =>
    context.i18n.t(key, fallback);

  useUsagePollingLease(context, `widget:${instanceId}`, visible);

  // Error state
  if (loadError) {
    return (
      <WidgetError message={loadError}>
        {t("pier.codex.widget.loadFailed", "Could not load Codex accounts")}
      </WidgetError>
    );
  }

  // Loading state
  if (!snapshot) {
    return <WidgetSkeleton data-slot="widget-skeleton" />;
  }

  const activeAccount = snapshot.accounts.find(
    (account) => account.id === snapshot.activeAccountId
  );
  const switchableAccounts = snapshot.accounts.filter(
    (account) => account.id !== snapshot.activeAccountId
  );
  const usage = snapshot.activeUsage;
  const fetchedLabel = usage
    ? formatRelativeTime(usage.fetchedAt, Date.now(), context.i18n.language())
    : null;
  const creditsLabel = activeAccount
    ? resetCredits(activeAccount, context.i18n.language(), t)
    : null;
  const accountLabel =
    activeAccount?.label ??
    t("pier.codex.widget.noActiveAccount", "No active account");
  let usageContent: JSX.Element;
  if (!usage) {
    usageContent = (
      <Skeleton className="min-h-20 w-full" data-slot="codex-usage-loading" />
    );
  } else if (usage.status === "ok") {
    usageContent = (
      <UsageMeter
        language={context.i18n.language()}
        t={t}
        windows={usage.windows}
      />
    );
  } else {
    usageContent = (
      <WidgetError
        message={
          usage.error ??
          t("pier.codex.accounts.settings.usageFailed", "Usage update failed")
        }
      />
    );
  }

  return (
    <div
      className="pier-codex-account-quota-widget flex h-full min-h-0 flex-col gap-3 p-(--card-spacing) text-sm"
      data-slot="codex-accounts-widget"
    >
      <Item className="flex-nowrap px-0 py-0" size="xs">
        <ItemMedia align="center">
          <AccountAvatar label={accountLabel} />
        </ItemMedia>
        <ItemContent className="min-w-0 basis-0">
          <ItemTitle className="block w-full truncate" title={accountLabel}>
            {accountLabel}
          </ItemTitle>
          <ItemDescription>
            <span>
              {activeAccount?.planType?.toUpperCase() ??
                t(
                  "pier.codex.widget.accountUnavailable",
                  "Account unavailable"
                )}
            </span>
            {fetchedLabel && size.w >= 4 ? (
              <span>
                {" · "}
                {fetchedLabel}
              </span>
            ) : null}
          </ItemDescription>
        </ItemContent>
        {creditsLabel && size.w >= 4 ? (
          <Badge size="xs" variant="neutral">
            {creditsLabel}
          </Badge>
        ) : null}
        {switchableAccounts.length > 0 ? (
          <ItemActions>
            <AccountPicker
              accounts={switchableAccounts}
              context={context}
              t={t}
            />
          </ItemActions>
        ) : null}
      </Item>

      <div className="flex min-h-0 flex-1 flex-col">{usageContent}</div>
    </div>
  );
}

/**
 * Async refresh action builder for the Codex accounts widget. The header
 * button's spinner covers the whole `accounts.refreshUsage` RPC round-trip.
 * Success/failure feedback stays with the plugin context.
 */
export function accountsWidgetActions(
  context: ExternalRendererPluginContext,
  _actionContext: MissionControlWidgetActionContext
): readonly RendererMissionControlWidgetAction[] {
  return [
    {
      icon: RefreshCw,
      id: "refresh",
      async invoke() {
        try {
          await context.rpc.invoke("accounts.refreshUsage", null);
          context.notifications.success(
            context.i18n.t(
              "pier.codex.accounts.settings.usageRefreshSuccess",
              "Usage refreshed"
            )
          );
        } catch (err) {
          await context.dialogs.alert({
            body: err instanceof Error ? err.message : String(err),
            title: context.i18n.t(
              "pier.codex.widget.refreshFailed",
              "Could not refresh Codex usage"
            ),
          });
        }
      },
      label: () =>
        context.i18n.t(
          "pier.codex.accounts.settings.refreshUsage",
          "Refresh usage"
        ),
      priority: 50,
    },
  ];
}
