import type {
  ExternalRendererPluginContext,
  MissionControlWidgetComponentProps,
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
import { Spinner } from "@pier/ui/spinner.tsx";
import { WidgetError, WidgetSkeleton } from "@pier/ui/widget-state.tsx";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { AccountAvatar, resetCredits } from "./account-display.tsx";
import { AccountPicker } from "./account-picker.tsx";
import { UsageMeter } from "./usage-meter.tsx";
import { useCodexAccountsSnapshot } from "./use-accounts-snapshot.ts";
import { useUsagePollingLease } from "./use-usage-polling-lease.ts";

/**
 * Codex account and quota widget. The host owns the outer Card and title.
 */

export interface AccountsWidgetProps
  extends MissionControlWidgetComponentProps {
  context: ExternalRendererPluginContext;
}

export function AccountsWidget({
  context,
  instanceId,
  refreshToken,
  visible,
}: AccountsWidgetProps): JSX.Element {
  const { error: loadError, snapshot } = useCodexAccountsSnapshot(context);
  const prevRefresh = useRef(refreshToken);
  const refreshRequestId = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const t = (key: string, fallback: string): string =>
    context.i18n.t(key, fallback);

  useUsagePollingLease(context, `widget:${instanceId}`, visible);

  // Refresh usage when refreshToken increments.
  useEffect(() => {
    if (!visible) {
      refreshRequestId.current += 1;
      setRefreshing(false);
      return;
    }
    if (refreshToken === prevRefresh.current) return;
    prevRefresh.current = refreshToken;
    const requestId = ++refreshRequestId.current;
    setRefreshing(true);
    context.rpc
      .invoke("accounts.refreshUsage", null)
      .then(() => {
        context.notifications.success(
          context.i18n.t(
            "pier.codex.accounts.settings.usageRefreshSuccess",
            "Usage refreshed"
          )
        );
      })
      .catch((err: unknown) => {
        context.dialogs
          .alert({
            title: context.i18n.t(
              "pier.codex.widget.refreshFailed",
              "Could not refresh Codex usage"
            ),
            body: err instanceof Error ? err.message : String(err),
          })
          .catch(() => undefined);
      })
      .finally(() => {
        if (refreshRequestId.current === requestId) setRefreshing(false);
      });
    return () => {
      if (refreshRequestId.current === requestId) {
        refreshRequestId.current += 1;
      }
    };
  }, [refreshToken, visible, context]);

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
      <Skeleton
        className="min-h-20 w-full flex-1"
        data-slot="codex-usage-loading"
      />
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
            {fetchedLabel ? (
              <span className="@[22rem]:inline hidden"> · {fetchedLabel}</span>
            ) : null}
          </ItemDescription>
        </ItemContent>
        {refreshing ? (
          <Badge size="xs" variant="neutral">
            <Spinner
              aria-label={t("pier.codex.widget.refreshing", "Refreshing")}
              className="motion-reduce:animate-none"
              data-icon="inline-start"
            />
            <span className="@[34rem]:inline hidden">
              {t("pier.codex.widget.refreshing", "Refreshing")}
            </span>
          </Badge>
        ) : null}
        {creditsLabel ? (
          <Badge
            className="@[34rem]:inline-flex hidden"
            size="xs"
            variant="neutral"
          >
            {creditsLabel}
          </Badge>
        ) : null}
        <ItemActions>
          <AccountPicker context={context} snapshot={snapshot} t={t} />
        </ItemActions>
      </Item>

      {usageContent}
    </div>
  );
}
