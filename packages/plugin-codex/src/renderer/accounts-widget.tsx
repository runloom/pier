import type {
  ExternalRendererPluginContext,
  RendererWorkbenchWidgetAction,
  WorkbenchWidgetActionContext,
  WorkbenchWidgetComponentProps,
} from "@pier/plugin-api/renderer";
import { Badge } from "@pier/ui/badge.tsx";
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
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { cn } from "@pier/ui/utils.ts";
import { WidgetError, WidgetSkeleton } from "@pier/ui/widget-state.tsx";
import { RefreshCw } from "lucide-react";
import type { JSX } from "react";
import {
  AccountAvatar,
  accountPlanSummary,
  resetCredits,
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
 * Refresh flows through {@link accountsWidgetActions}: the async invoke keeps
 * the header refresh-button spinner spinning for the real IPC duration.
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
  const fetchedLabel = usage
    ? formatRelativeTime(usage.fetchedAt, Date.now(), context.i18n.language())
    : null;
  const creditsLabel = activeAccount
    ? resetCredits(activeAccount, context.i18n.language(), t)
    : null;
  const accountLabel =
    activeAccount?.label ??
    t("pier.codex.widget.noActiveAccount", "No active account");
  // size 做结构：宽卡才在标题行露出 credits / 更新时间；矮卡藏 plan 副文案吃高度
  const showCredits = Boolean(creditsLabel) && size.w >= 4;
  const showFetchedInline = Boolean(fetchedLabel) && size.w >= 4;
  // 矮卡藏 plan 副文案；账号异常时仍展示（可用性优先于密度）
  const showPlanSummary =
    density !== "compact" || Boolean(activeAccount?.error);

  let usageContent: JSX.Element;
  if (!usage) {
    usageContent = (
      <Skeleton className="min-h-20 w-full" data-slot="codex-usage-loading" />
    );
  } else if (usage.status === "ok" || usage.windows.length > 0) {
    // last-good 窗口保留展示（对齐 Grok；瞬时刷新失败不清空进度）
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
      className={cn(
        "pier-codex-account-quota-widget text-sm",
        widgetShellClassName(density)
      )}
      data-density={density}
      data-size-h={size.h}
      data-size-w={size.w}
      data-slot="codex-accounts-widget"
    >
      <Item className="shrink-0 flex-nowrap px-0 py-0" size="xs">
        <ItemMedia align="center">
          <AccountAvatar label={accountLabel} />
        </ItemMedia>
        <ItemContent className="min-w-0 basis-0">
          <ItemTitle className="block w-full truncate" title={accountLabel}>
            {accountLabel}
          </ItemTitle>
          {showPlanSummary ? (
            <ItemDescription>
              <span>
                {(activeAccount
                  ? accountPlanSummary(
                      activeAccount,
                      context.i18n.language(),
                      t
                    )
                  : null) ??
                  t(
                    "pier.codex.widget.accountUnavailable",
                    "Account unavailable"
                  )}
              </span>
              {showFetchedInline ? (
                <span>
                  {" · "}
                  {fetchedLabel}
                </span>
              ) : null}
            </ItemDescription>
          ) : null}
        </ItemContent>
        {showCredits ? (
          <Badge className="shrink-0" size="xs" variant="neutral">
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col content-start">
        {usageContent}
      </div>
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
  _actionContext: WorkbenchWidgetActionContext
): readonly RendererWorkbenchWidgetAction[] {
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
