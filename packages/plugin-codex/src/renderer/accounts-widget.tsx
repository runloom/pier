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
import { Spinner } from "@pier/ui/spinner.tsx";
import {
  WidgetEmpty,
  WidgetError,
  WidgetSkeleton,
} from "@pier/ui/widget-state.tsx";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { AccountAvatar, resetCredits } from "./account-display.tsx";
import { AccountPicker } from "./account-picker.tsx";
import { UsageMeter } from "./usage-meter.tsx";
import { useCodexAccountsSnapshot } from "./use-accounts-snapshot.ts";

/**
 * Codex account and quota widget. The host owns the outer Card and title.
 */

export interface AccountsWidgetProps
  extends MissionControlWidgetComponentProps {
  context: ExternalRendererPluginContext;
}

export function AccountsWidget({
  context,
  refreshToken,
  visible,
}: AccountsWidgetProps): JSX.Element {
  const { error: loadError, snapshot } = useCodexAccountsSnapshot(context);
  const prevRefresh = useRef(refreshToken);
  const [refreshing, setRefreshing] = useState(false);
  const t = (key: string, fallback: string): string =>
    context.i18n.t(key, fallback);

  // Refresh usage when refreshToken increments
  useEffect(() => {
    if (!(visible && refreshToken !== prevRefresh.current)) return;
    prevRefresh.current = refreshToken;
    let cancelled = false;
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
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
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
  const hasUsage = usage?.status === "ok";
  const fetchedLabel = usage
    ? formatRelativeTime(usage.fetchedAt, Date.now(), context.i18n.language())
    : null;
  const creditsLabel = activeAccount
    ? resetCredits(activeAccount, context.i18n.language(), t)
    : null;
  const accountLabel =
    activeAccount?.label ??
    t("pier.codex.widget.noActiveAccount", "No active account");

  return (
    <div
      className="pier-codex-account-quota-widget codex:flex codex:h-full codex:min-h-0 codex:flex-col codex:gap-3 codex:p-(--card-spacing) codex:text-sm"
      data-slot="codex-accounts-widget"
    >
      <Item className="codex:flex-nowrap codex:px-0 codex:py-0" size="xs">
        <ItemMedia align="center">
          <AccountAvatar label={accountLabel} />
        </ItemMedia>
        <ItemContent className="codex:min-w-0 codex:basis-0">
          <ItemTitle
            className="codex:block codex:w-full codex:truncate"
            title={accountLabel}
          >
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
              <span className="codex:@[22rem]:inline codex:hidden">
                {" "}
                · {fetchedLabel}
              </span>
            ) : null}
          </ItemDescription>
        </ItemContent>
        {refreshing ? (
          <Badge size="xs" variant="neutral">
            <Spinner
              aria-label={t("pier.codex.widget.refreshing", "Refreshing")}
              className="codex:motion-reduce:animate-none"
              data-icon="inline-start"
            />
            <span className="codex:@[34rem]:inline codex:hidden">
              {t("pier.codex.widget.refreshing", "Refreshing")}
            </span>
          </Badge>
        ) : null}
        {creditsLabel ? (
          <Badge
            className="codex:@[34rem]:inline-flex codex:hidden"
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

      {hasUsage ? (
        <UsageMeter
          language={context.i18n.language()}
          t={t}
          windows={usage.windows}
        />
      ) : (
        <WidgetEmpty
          hint={t(
            "pier.codex.widget.noUsageHint",
            "Usage will appear after the next refresh."
          )}
          title={t("pier.codex.widget.noUsageData", "No usage data")}
        />
      )}
    </div>
  );
}
