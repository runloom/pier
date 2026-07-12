import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
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
import { ItemGroup, ItemSeparator } from "@pier/ui/item.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { cn } from "@pier/ui/utils.ts";
import { CircleUserRound, RefreshCw } from "lucide-react";
import { Fragment, type JSX } from "react";
import {
  AccountAvatar,
  OtherAccount,
  QuotaGroup,
  resetCredits,
} from "./account-display.tsx";
import { confirmAccountSwitch } from "./account-switch.ts";
import { AddAccountDialog } from "./add-account-dialog.tsx";
import { CostCard } from "./cost-card.tsx";
import type { Translate } from "./usage-meter.tsx";
import { useAccountsRefresh } from "./use-accounts-refresh.ts";
import { useCodexAccountsSnapshot } from "./use-accounts-snapshot.ts";

export interface AccountsSettingsPageProps {
  context: ExternalRendererPluginContext;
}

function SettingsSkeleton(): JSX.Element {
  return (
    <div className="pier-codex-settings">
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
  const { costRefreshing, refreshCost, refreshingAccountIds, refreshUsage } =
    useAccountsRefresh({ context, onAccountError: reportError, t });
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
  const handleSelect = async (accountId: string): Promise<void> => {
    const ok = await confirmAccountSwitch(context, t);
    if (ok) invoke("accounts.select", { accountId });
  };
  if (loadError)
    return (
      <div className="pier-codex-settings">
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
    <div className="pier-codex-settings">
      <header className="pier-codex-page-header">
        <h1>{t("pier.codex.accounts.settings.title", "Codex Accounts")}</h1>
        <AddAccountDialog
          context={context}
          login={snapshot.login}
          onError={reportError}
          t={t}
        />
      </header>
      {active ? (
        <>
          <Card data-testid="codex-active-account">
            <CardHeader>
              <div className="flex min-w-0 items-center gap-3">
                <AccountAvatar label={active.label} size="lg" />
                <div className="min-w-0">
                  <CardTitle className="truncate" title={active.label}>
                    {active.label}
                  </CardTitle>
                  <CardDescription>
                    {[
                      active.planType?.toUpperCase(),
                      resetCredits(active, language, t),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </CardDescription>
                </div>
              </div>
              <CardAction>
                <Badge variant="secondary">
                  {t(
                    "pier.codex.accounts.settings.systemDefault",
                    "System default"
                  )}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <QuotaGroup
                error={active.usage?.error}
                language={language}
                t={t}
                windows={active.usage?.windows ?? []}
              />
            </CardContent>
            <CardFooter className="justify-between">
              <span className="pier-codex-updated-at">
                {active.usage
                  ? `${t("pier.codex.accounts.settings.updated", "Updated")} ${formatRelativeTime(active.usage.fetchedAt, Date.now(), language)}`
                  : ""}
              </span>
              <Button
                aria-busy={refreshingAccountIds.has(active.id) || undefined}
                disabled={refreshingAccountIds.has(active.id)}
                onClick={() => refreshUsage(active.id)}
                size="sm"
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
                {t(
                  "pier.codex.accounts.settings.refreshUsage",
                  "Refresh usage"
                )}
              </Button>
            </CardFooter>
          </Card>
          <CostCard
            language={language}
            onRefresh={() => refreshCost()}
            refreshing={costRefreshing}
            snapshot={snapshot.costUsage}
            t={t}
          />
        </>
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
                    onSelect={() => handleSelect(account.id).catch(reportError)}
                    refreshing={refreshingAccountIds.has(account.id)}
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
