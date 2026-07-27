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
import { cn } from "@pier/ui/utils";
import { CircleUserRound, RefreshCw } from "lucide-react";
import { Fragment, type JSX, useCallback, useEffect, useState } from "react";
import {
  ALL_SYNC_TARGETS,
  EMPTY_PEER_AVAILABILITY,
  type PeerAvailability,
} from "../shared/accounts.ts";
import {
  AccountAvatar,
  accountDisplayLabel,
  accountMembershipSummary,
  OtherAccount,
  QuotaGroup,
} from "./account-display.tsx";
import {
  loadPeerAvailability,
  notifyPeerSyncFailures,
  openSwitchConfirmDialog,
} from "./account-switch.ts";
import { ActiveCardActions } from "./active-card-actions.tsx";
import { AddAccountDialog } from "./add-account-dialog.tsx";
import { formatAccountError, type Translate } from "./format-account-error.ts";
import { useAccountsRefresh } from "./use-accounts-refresh.ts";
import { useClaudeAccountsSnapshot } from "./use-accounts-snapshot.ts";
import { useUsagePollingLease } from "./use-usage-polling-lease.ts";

function samePeerAvailability(
  left: PeerAvailability,
  right: PeerAvailability
): boolean {
  return (
    left.omp === right.omp &&
    left.opencode === right.opencode &&
    left.pi === right.pi &&
    left.piOauthCapable === right.piOauthCapable
  );
}

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
  const [peerAvailability, setPeerAvailability] = useState<PeerAvailability>(
    EMPTY_PEER_AVAILABILITY
  );

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

  useEffect(() => {
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
    openSwitchConfirmDialog({ context, mode: "switch", t })
      .then((result) => {
        if (!result.confirmed) {
          return;
        }
        setBusyAccountId(accountId);
        context.rpc
          .invoke("accounts.select", {
            accountId,
            syncTargets: result.syncTargets.filter(
              (target) => target !== "claude"
            ),
          })
          .then((selectResult) => {
            notifyPeerSyncFailures(context, t, selectResult);
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
        if (!result.confirmed || result.syncTargets.length === 0) {
          return;
        }
        setBusyAccountId(accountId);
        context.rpc
          .invoke("accounts.syncToPeers", {
            accountId,
            syncTargets: result.syncTargets.filter(
              (target) => target !== "claude"
            ),
          })
          .then(() => {
            context.notifications.success(
              t(
                "pier.claude.accounts.settings.syncPeersSuccess",
                "Credentials synced"
              )
            );
          })
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
              <ActiveCardActions
                activeLabel={accountDisplayLabel(active)}
                onRefresh={() => refreshUsage(active.id)}
                onRemove={() => {
                  handleRemove(active.id, true).catch(() => undefined);
                }}
                onSyncPeers={() => handleSyncPeers(active.id)}
                refreshing={refreshingAll || activeRefreshing}
                removeDisabled={busyAccountId === active.id}
                showSyncPeers={
                  partitionPeerTargets(ALL_SYNC_TARGETS, peerAvailability)
                    .available.length > 0
                }
                t={t}
              />
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {snapshot.apiKeyModeDetected ? (
              <Alert data-testid="claude-api-key-mode" variant="info">
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
