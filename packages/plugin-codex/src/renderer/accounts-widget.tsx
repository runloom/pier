import {
  AccountWidgetFrame,
  accountWidgetMeterMetrics,
  createAccountsWidgetRefreshAction,
  resolveAccountWidgetPresentation,
} from "@pier/plugin-api/account-usage/renderer";
import type {
  ExternalRendererPluginContext,
  RendererWorkbenchWidgetAction,
  WorkbenchWidgetActionContext,
  WorkbenchWidgetComponentProps,
} from "@pier/plugin-api/renderer";
import { widgetDensityFor } from "@pier/ui/collection-auto-layout.ts";
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
import {
  AccountAvatar,
  AccountBadges,
  codexAccountMembership,
} from "./account-display.tsx";
import { AccountPicker } from "./account-picker.tsx";
import { UsageMeter } from "./usage-meter.tsx";
import { useCodexAccountsSnapshot } from "./use-accounts-snapshot.ts";
import { useUsagePollingLease } from "./use-usage-polling-lease.ts";

/**
 * Codex account and quota widget. The host owns the outer Card and title.
 *
 * 布局对齐成本 / 资源卡：size → density 结构；配额条 content auto-fit；
 * 顶对齐 + 无空 flex 壳浪费。
 *
 * Refresh uses the shared {@link createAccountsWidgetRefreshAction} path
 * (same `refreshAccountUsage` as the settings page).
 */

export interface AccountsWidgetProps extends WorkbenchWidgetComponentProps {
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

  if (loadError) {
    return (
      <WidgetError message={loadError}>
        {t("pier.codex.widget.loadFailed", "Could not load Codex accounts")}
      </WidgetError>
    );
  }

  if (!snapshot) {
    return <WidgetSkeleton data-slot="widget-skeleton" />;
  }

  const density = widgetDensityFor(size);
  const activeAccount = snapshot.accounts.find(
    (account) => account.id === snapshot.activeAccountId
  );
  const switchableAccounts = snapshot.accounts.filter(
    (account) => account.id !== snapshot.activeAccountId
  );
  const usage = snapshot.activeUsage;
  const accountLabel =
    activeAccount?.label ??
    t("pier.codex.widget.noActiveAccount", "No active account");
  const membership = activeAccount
    ? codexAccountMembership(
        activeAccount,
        activeAccount.usage?.updatedAt ?? usage?.updatedAt ?? 0
      )
    : undefined;
  const presentation = resolveAccountWidgetPresentation({
    accountCount: snapshot.accounts.length,
    density,
    hasAccountError: Boolean(activeAccount?.error),
    hasActiveAccount: Boolean(activeAccount),
    ...(membership ? { membership } : {}),
  });

  let usageContent: JSX.Element;
  if (!usage) {
    usageContent = (
      <Skeleton className="min-h-20 w-full" data-slot="codex-usage-loading" />
    );
  } else if (usage.status === "ok" || usage.metrics.length > 0) {
    // last-good 窗口保留展示（对齐 Grok；瞬时刷新失败不清空进度）
    usageContent = (
      <UsageMeter
        density={density}
        language={context.i18n.language()}
        metrics={accountWidgetMeterMetrics(
          usage.metrics,
          presentation.metadataMode
        )}
        status={usage.status}
        t={t}
        {...(usage.updatedAt === undefined
          ? {}
          : { updatedAt: usage.updatedAt })}
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

  let accountMetadata: JSX.Element | null = null;
  if (activeAccount?.error) {
    accountMetadata = (
      <ItemDescription>
        {t("pier.codex.widget.accountUnavailable", "Account unavailable")}
      </ItemDescription>
    );
  } else if (activeAccount) {
    accountMetadata = (
      <AccountBadges
        account={activeAccount}
        language={context.i18n.language()}
        mode={presentation.metadataMode}
        t={t}
      />
    );
  }

  return (
    <AccountWidgetFrame
      className="pier-codex-account-quota-widget text-sm"
      data-density={density}
      data-size-h={size.h}
      data-size-w={size.w}
      data-slot="codex-accounts-widget"
      density={density}
      header={
        presentation.showHeader ? (
          <Item className="shrink-0 flex-nowrap px-0 py-0" size="xs">
            {presentation.showAvatar ? (
              <ItemMedia align="center">
                <AccountAvatar label={accountLabel} />
              </ItemMedia>
            ) : null}
            <ItemContent className="min-w-0 basis-0">
              <ItemTitle className="block w-full truncate" title={accountLabel}>
                {accountLabel}
              </ItemTitle>
              {accountMetadata}
            </ItemContent>
            {presentation.showSwitcher && switchableAccounts.length > 0 ? (
              <ItemActions>
                <AccountPicker
                  accounts={switchableAccounts}
                  context={context}
                  t={t}
                />
              </ItemActions>
            ) : null}
          </Item>
        ) : undefined
      }
    >
      {usageContent}
    </AccountWidgetFrame>
  );
}

/**
 * Async refresh action for the Codex accounts widget. Header spinner covers
 * the full shared `refreshAccountUsage` round-trip (same as settings).
 */
export function accountsWidgetActions(
  context: ExternalRendererPluginContext,
  _actionContext: WorkbenchWidgetActionContext
): readonly RendererWorkbenchWidgetAction[] {
  return [
    createAccountsWidgetRefreshAction({
      context,
      icon: RefreshCw,
      i18n: {
        label: {
          fallback: "Refresh usage",
          key: "pier.codex.accounts.settings.refreshUsage",
        },
        noActiveAccountBody: {
          fallback: "No active account",
          key: "pier.codex.widget.noActiveAccount",
        },
        refreshFailedTitle: {
          fallback: "Could not refresh Codex usage",
          key: "pier.codex.widget.refreshFailed",
        },
        refreshSuccess: {
          fallback: "Usage refreshed",
          key: "pier.codex.accounts.settings.usageRefreshSuccess",
        },
      },
    }),
  ];
}
