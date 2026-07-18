import { partitionPeerTargets } from "@pier/plugin-api/peer-sync";
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
import { cn } from "@pier/ui/utils.ts";
import { CircleUserRound, RefreshCw, Share2 } from "lucide-react";
import { Fragment, type JSX, useEffect, useState } from "react";
import {
  ALL_SYNC_TARGETS,
  EMPTY_PEER_AVAILABILITY,
  type PeerAvailability,
  type PeerSyncTarget,
} from "../shared/accounts.ts";
import {
  AccountAvatar,
  accountPlanSummary,
  OtherAccount,
  QuotaGroup,
  resetCredits,
} from "./account-display.tsx";
import {
  loadPeerAvailability,
  openSwitchConfirmDialog,
} from "./account-switch.ts";
import { AddAccountDialog } from "./add-account-dialog.tsx";
import { formatAccountError } from "./format-account-error.ts";
import type { Translate } from "./usage-meter.tsx";
import { useAccountsRefresh } from "./use-accounts-refresh.ts";
import { useCodexAccountsSnapshot } from "./use-accounts-snapshot.ts";
import { useUsagePollingLease } from "./use-usage-polling-lease.ts";

export interface AccountsSettingsPageProps {
  context: ExternalRendererPluginContext;
}

function samePeerAvailability(
  left: PeerAvailability,
  right: PeerAvailability
): boolean {
  return (
    left.omp === right.omp &&
    left.opencode === right.opencode &&
    left.pi === right.pi
  );
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

function errorMessage(err: unknown, t: Translate): string {
  return formatAccountError(err, t);
}

export function AccountsSettingsPage({
  context,
}: AccountsSettingsPageProps): JSX.Element {
  const { error: loadError, snapshot } = useCodexAccountsSnapshot(context);
  useUsagePollingLease(context, "settings:accounts", true);
  const t: Translate = (key, fallback) => context.i18n.t(key, fallback);
  const [, setBusyAccountId] = useState<string | null>(null);
  const [peerAvailability, setPeerAvailability] = useState<PeerAvailability>(
    EMPTY_PEER_AVAILABILITY
  );
  useEffect(() => {
    // Share only appears for the active account. Skip probing on empty pages so
    // a late availability resolve cannot remount Add Account dialog callbacks.
    const activeAccountId = snapshot?.activeAccountId ?? null;
    if (!activeAccountId) {
      setPeerAvailability((prev) =>
        samePeerAvailability(prev, EMPTY_PEER_AVAILABILITY)
          ? prev
          : EMPTY_PEER_AVAILABILITY
      );
      return;
    }
    let cancelled = false;
    loadPeerAvailability(context)
      .then((availability) => {
        if (cancelled) return;
        setPeerAvailability((prev) =>
          samePeerAvailability(prev, availability) ? prev : availability
        );
      })
      .catch(() => {
        if (cancelled) return;
        setPeerAvailability((prev) =>
          samePeerAvailability(prev, EMPTY_PEER_AVAILABILITY)
            ? prev
            : EMPTY_PEER_AVAILABILITY
        );
      });
    return () => {
      cancelled = true;
    };
  }, [context, snapshot?.activeAccountId]);
  const reportError = (err: unknown): void => {
    context.dialogs
      .alert({
        body: errorMessage(err, t),
        title: t(
          "pier.codex.accounts.settings.actionFailed",
          "Account action failed"
        ),
      })
      .catch(() => undefined);
  };
  const invoke = (method: string, payload: unknown = null): void => {
    context.rpc.invoke(method, payload).catch(reportError);
  };
  const { refreshingAccountIds, refreshingAll, refreshAllUsage, refreshUsage } =
    useAccountsRefresh({
      context,
      onAccountError: reportError,
      t,
    });
  const handleRemove = async (accountId: string): Promise<void> => {
    const ok = await context.dialogs.confirm({
      body: t(
        "pier.codex.accounts.settings.removeConfirmBody",
        "This account will be removed from Pier."
      ),
      intent: "destructive",
      title: t(
        "pier.codex.accounts.settings.removeConfirmTitle",
        "Remove account?"
      ),
    });
    if (ok) invoke("accounts.remove", { accountId });
  };
  const handleSelect = (accountId: string): void => {
    openSwitchConfirmDialog({ context, mode: "switch", t })
      .then((result) => {
        if (!result.confirmed) return;
        setBusyAccountId(accountId);
        context.rpc
          .invoke("accounts.select", {
            accountId,
            syncTargets: result.syncTargets.filter(
              (target) => target !== "codex"
            ),
          })
          .catch(reportError)
          .finally(() => {
            setBusyAccountId(null);
          });
      })
      .catch(reportError);
  };

  const handleSyncPeers = (accountId: string): void => {
    openSwitchConfirmDialog({ context, mode: "sync", t })
      .then((result) => {
        if (!result.confirmed) return;
        const peers = result.syncTargets.filter(
          (target): target is PeerSyncTarget => target !== "codex"
        );
        if (peers.length === 0) return;
        context.rpc
          .invoke("accounts.syncToPeers", {
            accountId,
            syncTargets: peers,
          })
          .then(() => {
            context.notifications.success(
              t(
                "pier.codex.accounts.settings.syncPeersSuccess",
                "Synced credentials to selected tools"
              )
            );
          })
          .catch(reportError);
      })
      .catch(reportError);
  };

  if (loadError)
    return (
      <div className={SETTINGS_LAYOUT_CLASS}>
        <Alert variant="destructive">
          <AlertTitle>
            {t(
              "pier.codex.accounts.settings.loadFailed",
              "Could not load Codex accounts"
            )}
          </AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    );
  if (!snapshot) return <SettingsSkeleton />;
  const active =
    snapshot.accounts.find(
      (account) => account.id === snapshot.activeAccountId
    ) ?? null;
  const others = snapshot.accounts.filter(
    (account) => account.id !== snapshot.activeAccountId
  );
  const language = context.i18n.language();
  return (
    <div className={SETTINGS_LAYOUT_CLASS}>
      <header className="flex min-h-9 items-center justify-between gap-4">
        <h1 className="font-semibold text-xl tracking-tight">
          {t("pier.codex.accounts.settings.title", "Codex Accounts")}
        </h1>
        <div className="flex items-center gap-2">
          <Button
            aria-busy={refreshingAll || undefined}
            aria-label={t(
              "pier.codex.accounts.settings.refreshAllUsage",
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
          <AddAccountDialog
            context={context}
            login={snapshot.login}
            onError={reportError}
            t={t}
          />
        </div>
      </header>
      {active ? (
        <Card data-testid="codex-active-account" size="sm">
          <CardHeader className="items-center">
            <CardTitle>
              {t(
                "pier.codex.accounts.settings.currentAccount",
                "Current account"
              )}
            </CardTitle>
            <CardAction className="flex items-center gap-2">
              <TooltipProvider delayDuration={200}>
                {partitionPeerTargets(ALL_SYNC_TARGETS, peerAvailability)
                  .available.length > 0 ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t(
                          "pier.codex.accounts.settings.syncPeers",
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
                    <TooltipContent data-pier-codex-scope="">
                      {t(
                        "pier.codex.accounts.settings.syncPeers",
                        "Sync to other tools"
                      )}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-busy={
                        refreshingAccountIds.has(active.id) || undefined
                      }
                      aria-label={t(
                        "pier.codex.accounts.settings.refreshUsage",
                        "Refresh usage"
                      )}
                      disabled={
                        refreshingAll || refreshingAccountIds.has(active.id)
                      }
                      onClick={() => refreshUsage(active.id)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <RefreshCw
                        className={cn(
                          refreshingAccountIds.has(active.id) &&
                            "animate-spin motion-reduce:animate-none"
                        )}
                        data-icon="inline-start"
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent data-pier-codex-scope="">
                    {t(
                      "pier.codex.accounts.settings.refreshUsage",
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
                <AccountAvatar label={active.label} />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle title={active.label}>{active.label}</ItemTitle>
                <ItemDescription>
                  {[
                    accountPlanSummary(active, language, t),
                    resetCredits(active, language, t),
                    active.usage
                      ? `${t("pier.codex.accounts.settings.updated", "Updated")} ${formatRelativeTime(active.usage.fetchedAt, Date.now(), language)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </ItemDescription>
              </ItemContent>
            </Item>
            <ItemSeparator className="my-0" />
            <QuotaGroup
              error={active.usage?.error}
              language={language}
              loading={!active.usage}
              t={t}
              windows={active.usage?.windows ?? []}
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
                "pier.codex.accounts.settings.emptyTitle",
                "No managed accounts"
              )}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                "pier.codex.accounts.settings.emptyDesc",
                "Add a Codex account to get started."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {others.length > 0 ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>
              {t(
                "pier.codex.accounts.settings.otherAccounts",
                "Other accounts"
              )}
            </CardTitle>
            <CardAction>
              <Badge variant="secondary">{others.length}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="px-0" data-testid="codex-account-table">
            <ItemGroup className="gap-0">
              {others.map((account, index) => (
                <Fragment key={account.id}>
                  {index > 0 ? <ItemSeparator /> : null}
                  <OtherAccount
                    account={account}
                    language={language}
                    onRefresh={() => refreshUsage(account.id)}
                    onRemove={() => handleRemove(account.id).catch(reportError)}
                    onSelect={() => handleSelect(account.id)}
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
