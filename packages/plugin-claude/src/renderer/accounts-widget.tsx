import { createAccountsWidgetRefreshAction } from "@pier/plugin-api/account-usage/renderer";
import type {
  ExternalRendererPluginContext,
  RendererWorkbenchWidgetAction,
  WorkbenchWidgetActionContext,
  WorkbenchWidgetComponentProps,
} from "@pier/plugin-api/renderer";
import {
  widgetDensityFor,
  widgetShellClassName,
} from "@pier/ui/collection-auto-layout.ts";
import { formatRelativeTime } from "@pier/ui/format.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { cn } from "@pier/ui/utils.ts";
import { WidgetError, WidgetSkeleton } from "@pier/ui/widget-state.tsx";
import { RefreshCw } from "lucide-react";
import type { JSX } from "react";
import {
  AccountAvatar,
  accountDisplayLabel,
  accountMembershipSummary,
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
  const fetchedLabel = usage
    ? formatRelativeTime(usage.fetchedAt, Date.now(), context.i18n.language())
    : null;
  const accountLabel = activeAccount
    ? accountDisplayLabel(activeAccount)
    : t("pier.claude.widget.noActiveAccount", "No active account");
  let accountDescription = t(
    "pier.claude.widget.noActiveAccount",
    "No active account"
  );
  if (activeAccount) {
    accountDescription = activeAccount.error
      ? t(
          "pier.claude.widget.accountUnavailable",
          "Account unavailable — open Manage accounts to fix"
        )
      : accountMembershipSummary(activeAccount, context.i18n.language(), t);
  }
  // 小卡整段隐藏账号区，把高度留给额度
  const showAccountHeader = density !== "compact";
  const showFetchedInline =
    showAccountHeader && Boolean(fetchedLabel) && size.w >= 4;
  // 账号区可见时展示 membership；异常时也强制展示
  const showMembershipSummary =
    showAccountHeader || Boolean(activeAccount?.error);

  let usageContent: JSX.Element;
  if (!usage) {
    usageContent = <WidgetSkeleton data-slot="claude-usage-loading" />;
  } else if (usage.status === "ok" || usage.windows.length > 0) {
    // last-good 窗口保留展示（对齐 Grok）
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

  return (
    <div
      className={cn(
        "pier-claude-accounts-widget text-sm",
        widgetShellClassName(density)
      )}
      data-density={density}
      data-size-h={size.h}
      data-size-w={size.w}
      data-slot="claude-accounts-widget"
    >
      {showAccountHeader ? (
        <Item className="shrink-0 flex-nowrap px-0 py-0" size="xs">
          <ItemMedia align="center">
            <AccountAvatar label={accountLabel} />
          </ItemMedia>
          <ItemContent className="min-w-0 basis-0">
            <ItemTitle className="block w-full truncate" title={accountLabel}>
              {accountLabel}
            </ItemTitle>
            {showMembershipSummary ? (
              <ItemDescription>
                <span>{accountDescription}</span>
                {showFetchedInline ? (
                  <span>
                    {" · "}
                    {fetchedLabel}
                  </span>
                ) : null}
              </ItemDescription>
            ) : null}
          </ItemContent>
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
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col content-start">
        {usageContent}
      </div>
    </div>
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
