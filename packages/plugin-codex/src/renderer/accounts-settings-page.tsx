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
import { CircleUserRound, RefreshCw } from "lucide-react";
import { Fragment, type JSX, useState } from "react";
import type { CrossToolSyncTarget } from "../shared/accounts.ts";
import {
  AccountAvatar,
  OtherAccount,
  QuotaGroup,
  resetCredits,
} from "./account-display.tsx";
import { SwitchConfirmDialog } from "./account-switch.ts";
import { AddAccountDialog } from "./add-account-dialog.tsx";
import type { Translate } from "./usage-meter.tsx";
import { useAccountsRefresh } from "./use-accounts-refresh.ts";
import { useCodexAccountsSnapshot } from "./use-accounts-snapshot.ts";
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function AccountsSettingsPage({
  context,
}: AccountsSettingsPageProps): JSX.Element {
  const { error: loadError, snapshot } = useCodexAccountsSnapshot(context);
  useUsagePollingLease(context, "settings:accounts", true);
  const t: Translate = (key, fallback) => context.i18n.t(key, fallback);
  const reportError = (err: unknown): void => {
    context.dialogs
      .alert({
        body: errorMessage(err),
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
  const { refreshingAccountIds, refreshUsage } = useAccountsRefresh({
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
  const [dialogAccountId, setDialogAccountId] = useState<string | null>(null);
  const handleSelect = (accountId: string): void => {
    setDialogAccountId(accountId);
  };
  const handleDialogResult = ({
    confirmed,
    syncTargets,
  }: {
    confirmed: boolean;
    syncTargets: CrossToolSyncTarget[];
  }): void => {
    const accountId = dialogAccountId;
    setDialogAccountId(null);
    if (!(confirmed && accountId)) return;
    invoke("accounts.select", { accountId, syncTargets });
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
        <AddAccountDialog
          context={context}
          login={snapshot.login}
          onError={reportError}
          t={t}
        />
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
                      disabled={refreshingAccountIds.has(active.id)}
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
                    active.planType?.toUpperCase(),
                    resetCredits(active, language, t),
                    active.usage
                      ? `${t("pier.codex.accounts.settings.updated", "Updated")} ${formatRelativeTime(active.usage.fetchedAt, Date.now(), language)}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Badge variant="secondary">
                  {t(
                    "pier.codex.accounts.settings.systemDefault",
                    "System default"
                  )}
                </Badge>
              </ItemActions>
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
                    refreshing={refreshingAccountIds.has(account.id)}
                    t={t}
                  />
                </Fragment>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      ) : null}
      <SwitchConfirmDialog
        onResult={handleDialogResult}
        open={dialogAccountId !== null}
        t={t}
      />
    </div>
  );
}
