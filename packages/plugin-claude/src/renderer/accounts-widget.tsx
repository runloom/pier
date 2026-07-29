import {
  AccountWidgetFrame,
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
import { WidgetError, WidgetSkeleton } from "@pier/ui/widget-state.tsx";
import { RefreshCw } from "lucide-react";
import type { JSX } from "react";
import {
  AccountAvatar,
  AccountBadges,
  accountDisplayLabel,
  claudeAccountMembership,
} from "./account-display.tsx";
import { AccountPicker } from "./account-picker.tsx";
import { formatAccountError, type Translate } from "./format-account-error.ts";
import { UsageMeter } from "./usage-meter.tsx";
import { useClaudeAccountsSnapshot } from "./use-accounts-snapshot.ts";
import { useUsagePollingLease } from "./use-usage-polling-lease.ts";

export interface AccountsWidgetProps extends WorkbenchWidgetComponentProps {
  context: ExternalRendererPluginContext;
}

export function AccountsWidget({
  context,
  instanceId,
  size,
  visible,
}: AccountsWidgetProps): JSX.Element {
  const { error: loadError, snapshot } = useClaudeAccountsSnapshot(context);
  const t: Translate = (key, fallback) => context.i18n.t(key, fallback);

  useUsagePollingLease(context, `widget:${instanceId}`, visible);

  if (loadError) {
    return (
      <WidgetError message={formatAccountError(loadError, t)}>
        {t("pier.claude.widget.loadFailed", "Could not load Claude accounts")}
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
  const accountLabel = activeAccount
    ? accountDisplayLabel(activeAccount)
    : t("pier.claude.widget.noActiveAccount", "No active account");
  const membership = activeAccount
    ? claudeAccountMembership(
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
    usageContent = <WidgetSkeleton data-slot="claude-usage-loading" />;
  } else if (usage.status === "ok" || usage.metrics.length > 0) {
    // last-good 窗口保留展示（对齐 Grok）
    usageContent = (
      <UsageMeter
        density={density}
        language={context.i18n.language()}
        metrics={usage.metrics}
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
        message={formatAccountError(
          usage.error ??
            t(
              "pier.claude.accounts.settings.usageFailed",
              "Usage update failed"
            ),
          t
        )}
      />
    );
  }

  let accountMetadata: JSX.Element | null = null;
  if (activeAccount?.error) {
    accountMetadata = (
      <ItemDescription>
        {t(
          "pier.claude.widget.accountUnavailable",
          "Account unavailable — open Manage accounts to fix"
        )}
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
      className="pier-claude-accounts-widget text-sm"
      data-density={density}
      data-size-h={size.h}
      data-size-w={size.w}
      data-slot="claude-accounts-widget"
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

/** Shared {@link createAccountsWidgetRefreshAction} (same RPC as settings). */
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
          key: "pier.claude.accounts.settings.refreshUsage",
        },
        noActiveAccountBody: {
          fallback:
            "No active account — add or switch to a Claude account first",
          key: "pier.claude.errors.noActiveAccount",
        },
        refreshFailedTitle: {
          fallback: "Could not refresh Claude usage",
          key: "pier.claude.widget.refreshFailed",
        },
        refreshSuccess: {
          fallback: "Usage refreshed",
          key: "pier.claude.accounts.settings.usageRefreshSuccess",
        },
      },
    }),
  ];
}
