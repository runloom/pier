import type {
  ExternalRendererPluginContext,
  RendererWorkbenchWidgetAction,
  WorkbenchWidgetActionContext,
  WorkbenchWidgetComponentProps,
} from "@pier/plugin-api/renderer";
import { formatRelativeTime } from "@pier/ui/format.tsx";
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

  let usageContent: JSX.Element;
  if (!usage) {
    usageContent = <WidgetSkeleton data-slot="claude-usage-loading" />;
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
      className="pier-claude-accounts-widget flex h-full min-h-0 flex-col gap-3 p-(--card-spacing) text-sm"
      data-slot="claude-accounts-widget"
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
            <span>{accountDescription}</span>
            {fetchedLabel && size.w >= 4 ? (
              <span>
                {" · "}
                {fetchedLabel}
              </span>
            ) : null}
          </ItemDescription>
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

      <div className="flex min-h-0 flex-1 flex-col">{usageContent}</div>
    </div>
  );
}

export function accountsWidgetActions(
  context: ExternalRendererPluginContext,
  _actionContext: WorkbenchWidgetActionContext
): readonly RendererWorkbenchWidgetAction[] {
  return [
    {
      icon: RefreshCw,
      id: "refresh",
      async invoke() {
        try {
          // No active account → nothing to refresh; a success toast next to
          // an error meter would be contradictory feedback.
          const snapshot = await context.rpc.invoke<{
            activeAccountId: string | null;
          }>("accounts.snapshot", null);
          if (!snapshot.activeAccountId) {
            await context.dialogs.alert({
              body: context.i18n.t(
                "pier.claude.errors.noActiveAccount",
                "No active account — add or switch to a Claude account first"
              ),
              title: context.i18n.t(
                "pier.claude.widget.refreshFailed",
                "Could not refresh Claude usage"
              ),
            });
            return;
          }
          await context.rpc.invoke("accounts.refreshUsage", { force: true });
          context.notifications.success(
            context.i18n.t(
              "pier.claude.accounts.settings.usageRefreshSuccess",
              "Usage refreshed"
            )
          );
        } catch (err) {
          await context.dialogs.alert({
            body: err instanceof Error ? err.message : String(err),
            title: context.i18n.t(
              "pier.claude.widget.refreshFailed",
              "Could not refresh Claude usage"
            ),
          });
        }
      },
      label: () =>
        context.i18n.t(
          "pier.claude.accounts.settings.refreshUsage",
          "Refresh usage"
        ),
      priority: 50,
    },
  ];
}
