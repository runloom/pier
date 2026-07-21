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
  QuotaGroup,
} from "./account-display.tsx";
import { AccountPicker } from "./account-picker.tsx";
import { formatAccountError, type Translate } from "./format-account-error.ts";
import { useGrokAccountsSnapshot } from "./use-accounts-snapshot.ts";
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
  const { error: loadError, snapshot } = useGrokAccountsSnapshot(context);
  const t: Translate = (key, fallback) => context.i18n.t(key, fallback);

  useUsagePollingLease(context, `widget:${instanceId}`, visible);

  if (loadError) {
    return (
      <WidgetError message={formatAccountError(loadError, t)}>
        {t("pier.grok.widget.loadFailed", "Could not load Grok accounts")}
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
    : t("pier.grok.widget.noActiveAccount", "No active account");

  let usageContent: JSX.Element;
  if (!usage) {
    usageContent = <WidgetSkeleton data-slot="grok-usage-loading" />;
  } else if (usage.status === "ok") {
    usageContent = (
      <QuotaGroup
        compact
        error={undefined}
        language={context.i18n.language()}
        loading={false}
        t={t}
        windows={usage.windows}
      />
    );
  } else {
    usageContent = (
      <QuotaGroup
        compact
        error={formatAccountError(
          usage.error ??
            t("pier.grok.accounts.settings.usageFailed", "Usage update failed"),
          t
        )}
        language={context.i18n.language()}
        loading={false}
        t={t}
        windows={usage.windows}
      />
    );
  }

  return (
    <div
      className="pier-grok-accounts-widget flex h-full min-h-0 flex-col gap-3 p-(--card-spacing) text-sm"
      data-slot="grok-accounts-widget"
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
              {activeAccount
                ? accountMembershipSummary(
                    activeAccount,
                    context.i18n.language(),
                    t
                  )
                : t("pier.grok.widget.noActiveAccount", "No active account")}
            </span>
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
                "pier.grok.widget.noActiveAccount",
                "No active account"
              ),
              title: context.i18n.t(
                "pier.grok.widget.refreshFailed",
                "Could not refresh Grok usage"
              ),
            });
            return;
          }
          await context.rpc.invoke("accounts.refreshUsage", { force: true });
          context.notifications.success(
            context.i18n.t(
              "pier.grok.accounts.settings.usageRefreshSuccess",
              "Usage refreshed"
            )
          );
        } catch (err) {
          await context.dialogs.alert({
            body: err instanceof Error ? err.message : String(err),
            title: context.i18n.t(
              "pier.grok.widget.refreshFailed",
              "Could not refresh Grok usage"
            ),
          });
        }
      },
      label: () =>
        context.i18n.t(
          "pier.grok.accounts.settings.refreshUsage",
          "Refresh usage"
        ),
      priority: 50,
    },
  ];
}
