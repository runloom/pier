import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@pier/ui/card.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { formatRelativeTime } from "@pier/ui/format.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils";
import { CircleUserRound, KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { Fragment, type JSX, useCallback, useState } from "react";
import {
  AccountAvatar,
  accountDisplayLabel,
  accountMembershipSummary,
  OtherAccount,
  QuotaGroup,
} from "./account-display.tsx";
import { confirmSwitch } from "./account-switch.ts";
import { AddAccountDialog } from "./add-account-dialog.tsx";
import { formatAccountError, type Translate } from "./format-account-error.ts";
import { useAccountsRefresh } from "./use-accounts-refresh.ts";
import { useClaudeAccountsSnapshot } from "./use-accounts-snapshot.ts";
import { useUsagePollingLease } from "./use-usage-polling-lease.ts";

export interface AccountsSettingsPageProps {
  context: ExternalRendererPluginContext;
}

const SETTINGS_LAYOUT_CLASS =
  "flex w-full max-w-[62rem] flex-col gap-4 px-4 pb-8";

function SettingsSkeleton(): JSX.Element {
  return (
    <div className={SETTINGS_LAYOUT_CLASS}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

export function AccountsSettingsPage({
  context,
}: AccountsSettingsPageProps): JSX.Element {
  const { error: loadError, snapshot } = useClaudeAccountsSnapshot(context);
  const t: Translate = useCallback(
    (key, fallback) => context.i18n.t(key, fallback),
    [context]
  );
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);

  const reportError = useCallback(
    (err: unknown): void => {
      context.dialogs
        .alert({
          body: formatAccountError(err, t),
          title: t(
            "pier.claude.accounts.settings.actionFailed",
            "Account action failed"
          ),
        })
        .catch(() => undefined);
    },
    [context, t]
  );

  useUsagePollingLease(context, "settings:accounts", true);
  const { refreshingAccountIds, refreshingAll, refreshAllUsage, refreshUsage } =
    useAccountsRefresh({
      context,
      onAccountError: reportError,
      t,
    });

  const handleRemove = async (
    accountId: string,
    isActive = false
  ): Promise<void> => {
    const ok = await context.dialogs.confirm({
      body: isActive
        ? t(
            "pier.claude.accounts.settings.removeActiveConfirmBody",
            "Pier will stop managing this account and clear the current selection. Your Claude login on this device is not affected. If you stay signed in with the CLI, Pier may import this account again automatically."
          )
        : t(
            "pier.claude.accounts.settings.removeConfirmBody",
            "This account will be removed from Pier. Your Claude login on this device is not affected."
          ),
      confirmLabel: t("pier.claude.accounts.settings.remove", "Remove"),
      intent: "destructive",
      size: "sm",
      title: t(
        "pier.claude.accounts.settings.removeConfirmTitle",
        "Remove account?"
      ),
    });
    if (!ok) {
      return;
    }
    setBusyAccountId(accountId);
    try {
      await context.rpc.invoke("accounts.remove", { accountId });
    } catch (error) {
      reportError(error);
    } finally {
      setBusyAccountId(null);
    }
  };

  const handleSelect = (accountId: string): void => {
    confirmSwitch({ context, t })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        setBusyAccountId(accountId);
        context.rpc
          .invoke("accounts.select", { accountId })
          .catch(reportError)
          .finally(() => {
            setBusyAccountId(null);
          });
      })
      .catch(reportError);
  };

  if (loadError) {
    return (
      <div className={SETTINGS_LAYOUT_CLASS}>
        <Alert variant="destructive">
          <AlertTitle>
            {t(
              "pier.claude.accounts.settings.loadFailed",
              "Could not load Claude accounts"
            )}
          </AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!snapshot) {
    return <SettingsSkeleton />;
  }

  const active =
    snapshot.accounts.find(
      (account) => account.id === snapshot.activeAccountId
    ) ?? null;
  const others = snapshot.accounts.filter(
    (account) => account.id !== snapshot.activeAccountId
  );
  const language = context.i18n.language();
  const activeUsage = snapshot.activeUsage;
  const activeRefreshing = active ? refreshingAccountIds.has(active.id) : false;

  return (
    <div className={SETTINGS_LAYOUT_CLASS}>
      <header className="flex min-h-9 items-center justify-between gap-4">
        <h1 className="font-semibold text-xl tracking-tight">
          {t("pier.claude.accounts.settings.title", "Claude Accounts")}
        </h1>
        <div className="flex items-center gap-2">
          <Button
            aria-busy={refreshingAll || undefined}
            aria-label={t(
              "pier.claude.accounts.settings.refreshAllUsage",
              "Refresh all usage"
            )}
            disabled={refreshingAll || snapshot.accounts.length === 0}
            onClick={() => {
              refreshAllUsage(snapshot.accounts.map((account) => account.id));
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <RefreshCw
              className={cn(
                refreshingAll && "animate-spin motion-reduce:animate-none"
              )}
              data-icon="inline-start"
            />
          </Button>
          <AddAccountDialog context={context} onError={reportError} t={t} />
        </div>
      </header>

      {active ? (
        <Card data-testid="claude-active-account" size="sm">
          <CardHeader className="items-center">
            <CardTitle>
              {t(
                "pier.claude.accounts.settings.currentAccount",
                "Current account"
              )}
            </CardTitle>
            <CardAction className="flex items-center gap-2">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-busy={refreshingAll || activeRefreshing || undefined}
                      aria-label={t(
                        "pier.claude.accounts.settings.refreshUsage",
                        "Refresh usage"
                      )}
                      disabled={refreshingAll || activeRefreshing}
                      onClick={() => refreshUsage(active.id)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <RefreshCw
                        className={cn(
                          (refreshingAll || activeRefreshing) &&
                            "animate-spin motion-reduce:animate-none"
                        )}
                        data-icon="inline-start"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent data-pier-claude-scope="">
                    {t(
                      "pier.claude.accounts.settings.refreshUsage",
                      "Refresh usage"
                    )}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={`${t("pier.claude.accounts.settings.remove", "Remove")}: ${accountDisplayLabel(active)}`}
                      disabled={busyAccountId === active.id}
                      onClick={() => {
                        handleRemove(active.id, true).catch(() => undefined);
                      }}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 data-icon="inline-start" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent data-pier-claude-scope="">
                    {t("pier.claude.accounts.settings.remove", "Remove")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {snapshot.apiKeyModeDetected ? (
              <Alert data-testid="claude-api-key-mode">
                <KeyRound />
                <AlertTitle>
                  {t(
                    "pier.claude.accounts.settings.apiKeyModeTitle",
                    "API key mode detected"
                  )}
                </AlertTitle>
                <AlertDescription>
                  {t(
                    "pier.claude.accounts.settings.apiKeyModeBody",
                    "This device is configured with an Anthropic API key (ANTHROPIC_API_KEY); Claude sessions may use it instead of a managed account."
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            <Item className="px-0 py-0" size="sm">
              <ItemMedia align="center">
                <AccountAvatar label={accountDisplayLabel(active)} />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle title={accountDisplayLabel(active)}>
                  {accountDisplayLabel(active)}
                </ItemTitle>
                <ItemDescription>
                  {[
                    active.error
                      ? formatAccountError(active.error, t)
                      : accountMembershipSummary(active, language, t),
                    activeUsage
                      ? `${t("pier.claude.accounts.settings.updated", "Updated")} ${formatRelativeTime(activeUsage.fetchedAt, Date.now(), language)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </ItemDescription>
              </ItemContent>
            </Item>
            <ItemSeparator className="my-0" />
            <QuotaGroup
              error={
                activeUsage?.status === "error"
                  ? (activeUsage.error ??
                    t(
                      "pier.claude.accounts.settings.usageFailed",
                      "Usage update failed"
                    ))
                  : undefined
              }
              language={language}
              loading={!activeUsage}
              t={t}
              windows={activeUsage?.windows ?? []}
            />
          </CardContent>
        </Card>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleUserRound />
            </EmptyMedia>
            <EmptyTitle>
              {t(
                "pier.claude.accounts.settings.emptyTitle",
                "No managed accounts"
              )}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                "pier.claude.accounts.settings.emptyDesc",
                "Sign in with your browser, or import the Claude CLI login to get started."
              )}
              {snapshot.apiKeyModeDetected
                ? ` ${t(
                    "pier.claude.accounts.settings.apiKeyModeBody",
                    "This device is configured with an Anthropic API key (ANTHROPIC_API_KEY); Claude sessions may use it instead of a managed account."
                  )}`
                : ""}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {others.length > 0 ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>
              {t(
                "pier.claude.accounts.settings.otherAccounts",
                "Other accounts"
              )}
            </CardTitle>
            <CardAction>
              <Badge variant="secondary">{others.length}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0" data-testid="claude-account-table">
            <ItemGroup className="gap-0">
              {others.map((account, index) => (
                <Fragment key={account.id}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <OtherAccount
                    account={account}
                    busy={busyAccountId === account.id}
                    language={language}
                    onRefreshUsage={refreshUsage}
                    onRemove={(id) => {
                      handleRemove(id).catch(() => undefined);
                    }}
                    onSelect={handleSelect}
                    refreshing={
                      refreshingAll || refreshingAccountIds.has(account.id)
                    }
                    t={t}
                  />
                </Fragment>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
