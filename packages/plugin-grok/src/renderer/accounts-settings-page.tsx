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
  ItemActions,
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
import { cn } from "@pier/ui/utils.ts";
import { CircleUserRound, RefreshCw, Share2 } from "lucide-react";
import { Fragment, type JSX, useState } from "react";
import type { PeerSyncTarget } from "../shared/accounts.ts";
import {
  AccountAvatar,
  accountDisplayLabel,
  OtherAccount,
  QuotaGroup,
} from "./account-display.tsx";
import { openSwitchConfirmDialog } from "./account-switch.ts";
import { AddAccountDialog } from "./add-account-dialog.tsx";
import { formatAccountError, type Translate } from "./format-account-error.ts";
import { useAccountsRefresh } from "./use-accounts-refresh.ts";
import { useGrokAccountsSnapshot } from "./use-accounts-snapshot.ts";
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
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-36 w-full" />
    </div>
  );
}

export function AccountsSettingsPage({
  context,
}: AccountsSettingsPageProps): JSX.Element {
  const { error: loadError, snapshot } = useGrokAccountsSnapshot(context);
  useUsagePollingLease(context, "settings:accounts", true);
  const t: Translate = (key, fallback) => context.i18n.t(key, fallback);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);

  const reportError = (err: unknown): void => {
    context.dialogs
      .alert({
        body: formatAccountError(err, t),
        title: t(
          "pier.grok.accounts.settings.actionFailed",
          "Account action failed"
        ),
      })
      .catch(() => undefined);
  };

  const { refreshUsage, refreshingAccountIds } = useAccountsRefresh({
    context,
    onAccountError: reportError,
    t,
  });

  const handleRemove = async (accountId: string): Promise<void> => {
    const ok = await context.dialogs.confirm({
      body: t(
        "pier.grok.accounts.settings.removeConfirmBody",
        "This account will be removed from Pier. Credentials stored for this account are deleted."
      ),
      intent: "destructive",
      title: t(
        "pier.grok.accounts.settings.removeConfirmTitle",
        "Remove Grok account?"
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
    openSwitchConfirmDialog({ context, mode: "switch", t }).then((result) => {
      if (!result.confirmed) {
        return;
      }
      setBusyAccountId(accountId);
      context.rpc
        .invoke("accounts.select", {
          accountId,
          syncTargets: result.syncTargets.filter((target) => target !== "grok"),
        })
        .catch(reportError)
        .finally(() => {
          setBusyAccountId(null);
        });
    });
  };

  const handleSyncPeers = (accountId: string): void => {
    openSwitchConfirmDialog({ context, mode: "sync", t }).then((result) => {
      if (!result.confirmed) {
        return;
      }
      const peers = result.syncTargets.filter(
        (target): target is PeerSyncTarget => target !== "grok"
      );
      if (peers.length === 0) {
        return;
      }
      context.rpc
        .invoke("accounts.syncToPeers", {
          accountId,
          syncTargets: peers,
        })
        .then(() => {
          context.notifications.success(
            t(
              "pier.grok.accounts.settings.syncPeersSuccess",
              "Synced credentials to selected tools"
            )
          );
        })
        .catch(reportError);
    });
  };

  if (loadError) {
    return (
      <div className={SETTINGS_LAYOUT_CLASS}>
        <Alert variant="destructive">
          <AlertTitle>
            {t(
              "pier.grok.accounts.settings.loadFailed",
              "Could not load Grok accounts"
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
  const activeRefreshing =
    active !== null &&
    (refreshingAccountIds.has(active.id) ||
      refreshingAccountIds.has("__active__"));

  return (
    <div className={SETTINGS_LAYOUT_CLASS}>
      <header className="flex min-h-9 items-center justify-between gap-4">
        <h1 className="font-semibold text-xl tracking-tight">
          {t("pier.grok.accounts.settings.title", "Grok Accounts")}
        </h1>
        <AddAccountDialog
          context={context}
          login={snapshot.login}
          onError={reportError}
          t={t}
        />
      </header>

      {snapshot.login ? (
        <Alert>
          <AlertTitle>
            {t("pier.grok.accounts.settings.loginPending", "Login pending")}
          </AlertTitle>
          <AlertDescription>
            {snapshot.login.mode === "device"
              ? t(
                  "pier.grok.accounts.settings.addDialogDeviceDescription",
                  "Use device-code login when browser OAuth is unavailable."
                )
              : t(
                  "pier.grok.accounts.settings.addDialogOauthDescription",
                  "Open Grok login in your browser. The account appears here automatically after authorization."
                )}
          </AlertDescription>
        </Alert>
      ) : null}

      {active ? (
        <Card data-testid="grok-active-account" size="sm">
          <CardHeader className="items-center">
            <CardTitle>
              {t(
                "pier.grok.accounts.settings.currentAccount",
                "Current account"
              )}
            </CardTitle>
            <CardAction className="flex items-center gap-2">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={t(
                        "pier.grok.accounts.settings.syncPeers",
                        "Sync to other tools"
                      )}
                      onClick={() => handleSyncPeers(active.id)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Share2 data-icon="inline-start" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent data-pier-grok-scope="">
                    {t(
                      "pier.grok.accounts.settings.syncPeers",
                      "Sync to other tools"
                    )}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-busy={activeRefreshing || undefined}
                      aria-label={t(
                        "pier.grok.accounts.settings.refreshUsage",
                        "Refresh usage"
                      )}
                      disabled={activeRefreshing}
                      onClick={() => refreshUsage(active.id)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <RefreshCw
                        className={cn(
                          activeRefreshing &&
                            "animate-spin motion-reduce:animate-none"
                        )}
                        data-icon="inline-start"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent data-pier-grok-scope="">
                    {t(
                      "pier.grok.accounts.settings.refreshUsage",
                      "Refresh usage"
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
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
                    active.kind === "api_key" ? "API key" : "OIDC",
                    activeUsage
                      ? `${t("pier.grok.accounts.settings.updated", "Updated")} ${formatRelativeTime(activeUsage.fetchedAt, Date.now(), language)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant="secondary">
                  {t("pier.grok.accounts.settings.account", "Account")}
                </Badge>
              </ItemActions>
            </Item>
            <ItemSeparator className="my-0" />
            <QuotaGroup
              error={activeUsage?.error}
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
                "pier.grok.accounts.settings.emptyTitle",
                "No managed accounts"
              )}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                "pier.grok.accounts.settings.emptyDesc",
                "Add a Grok account to get started."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {others.length > 0 ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>
              {t("pier.grok.accounts.settings.otherAccounts", "Other accounts")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ItemGroup>
              {others.map((account, index) => (
                <Fragment key={account.id}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <OtherAccount
                    account={account}
                    busy={busyAccountId === account.id}
                    onRemove={(id) => {
                      handleRemove(id).catch(() => undefined);
                    }}
                    onSelect={handleSelect}
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
