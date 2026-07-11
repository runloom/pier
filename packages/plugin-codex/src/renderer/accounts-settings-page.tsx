import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pier/ui/table.tsx";
import { CircleUserRound, Plus } from "lucide-react";
import type { JSX } from "react";
import { AccountUsageRow, type Translate } from "./account-usage-row.tsx";
import { useCodexAccountsSnapshot } from "./use-accounts-snapshot.ts";

export interface AccountsSettingsPageProps {
  context: ExternalRendererPluginContext;
}

const ACCOUNT_SKELETON_ROWS = ["account-1", "account-2", "account-3"];

function AccountsTableSkeleton(): JSX.Element {
  return (
    <div className="px-4 pb-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Skeleton className="h-7 w-28 rounded-lg" />
        <Skeleton className="h-8 w-24 rounded-full" />
      </div>
      <div className="pier-codex-account-table-shell">
        <Table className="pier-codex-account-table">
          <colgroup>
            <col className="pier-codex-account-column" />
            <col className="pier-codex-plan-column" />
            <col className="pier-codex-usage-column" />
            <col className="pier-codex-actions-column" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Skeleton className="h-3 w-12 rounded-md" />
              </TableHead>
              <TableHead>
                <Skeleton className="h-3 w-12 rounded-md" />
              </TableHead>
              <TableHead>
                <Skeleton className="h-3 w-10 rounded-md" />
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ACCOUNT_SKELETON_ROWS.map((row) => (
              <TableRow className="pier-codex-account-row" key={row}>
                <TableCell>
                  <Skeleton className="h-4 w-4/5 rounded-md" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-10 rounded-full" />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-3 w-2/5 rounded-md" />
                    <Skeleton className="h-1.5 w-full rounded-full" />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Skeleton className="size-7 rounded-full" />
                    <Skeleton className="size-7 rounded-full" />
                    <Skeleton className="size-7 rounded-full" />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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
    context.dialogs.alert({
      title: t(
        "pier.codex.accounts.settings.actionFailed",
        "Account action failed"
      ),
      body: errorMessage(err),
    });
  };

  const invoke = (method: string, payload: unknown = null): void => {
    context.rpc.invoke(method, payload).catch(reportError);
  };

  const handleRemove = async (accountId: string): Promise<void> => {
    const ok = await context.dialogs.confirm({
      title: t(
        "pier.codex.accounts.settings.removeConfirmTitle",
        "Remove account?"
      ),
      body: t(
        "pier.codex.accounts.settings.removeConfirmBody",
        "This account will be removed from Pier. Your Codex login on this device is not affected."
      ),
      intent: "destructive",
    });
    if (!ok) return;
    invoke("accounts.remove", { accountId });
  };

  if (loadError) {
    return (
      <div className="px-4 pb-4">
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
  }

  if (!snapshot) {
    return <AccountsTableSkeleton />;
  }

  const language = context.i18n.language();

  return (
    <div className="px-4 pb-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h1 className="text-xl">
          {t("pier.codex.accounts.settings.title", "Codex Accounts")}
        </h1>
        <Button
          disabled={snapshot.login !== null}
          onClick={() => invoke("accounts.add", {})}
          type="button"
        >
          <Plus data-icon="inline-start" />
          {t("pier.codex.accounts.settings.addAccount", "Add account")}
        </Button>
      </div>

      {snapshot.login ? (
        <Alert className="mb-4">
          <AlertTitle>
            {t(
              "pier.codex.accounts.settings.loginPending",
              "Login in progress"
            )}
          </AlertTitle>
          <AlertDescription>
            {t(
              "pier.codex.accounts.settings.loginPendingDesc",
              "Finish the Codex login flow in your browser or cancel it before adding another account."
            )}
          </AlertDescription>
          <Button
            className="mt-3"
            onClick={() => invoke("accounts.cancelLogin", null)}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("pier.codex.accounts.settings.cancelLogin", "Cancel login")}
          </Button>
        </Alert>
      ) : null}

      {snapshot.accounts.length > 0 ? (
        <div
          className="pier-codex-account-table-shell"
          data-testid="codex-account-table"
        >
          <Table className="pier-codex-account-table">
            <colgroup>
              <col className="pier-codex-account-column" />
              <col className="pier-codex-plan-column" />
              <col className="pier-codex-usage-column" />
              <col className="pier-codex-actions-column" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t("pier.codex.accounts.settings.account", "Account")}
                </TableHead>
                <TableHead>
                  {t(
                    "pier.codex.accounts.settings.subscription",
                    "Subscription"
                  )}
                </TableHead>
                <TableHead>
                  {t("pier.codex.accounts.settings.usage", "Quota status")}
                </TableHead>
                <TableHead className="pier-codex-actions-head">
                  {t("pier.codex.accounts.settings.actions", "Actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.accounts.map((account) => {
                const isSystemDefault = account.id === snapshot.activeAccountId;
                return (
                  <AccountUsageRow
                    description={account.error ?? undefined}
                    isSystemDefault={isSystemDefault}
                    key={account.id}
                    label={account.label}
                    language={language}
                    onRefresh={() =>
                      invoke("accounts.refreshUsage", {
                        accountId: account.id,
                      })
                    }
                    onRemove={
                      isSystemDefault
                        ? undefined
                        : () => handleRemove(account.id).catch(reportError)
                    }
                    onSelect={
                      isSystemDefault
                        ? undefined
                        : () =>
                            invoke("accounts.select", {
                              accountId: account.id,
                            })
                    }
                    planType={account.planType}
                    status={account.status}
                    t={t}
                    usage={account.usage}
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Empty className="border border-dashed">
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
    </div>
  );
}
