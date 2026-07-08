import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import type {
  CodexAccountStatus,
  CodexAccountsSnapshot,
} from "../shared/accounts.ts";

/**
 * Codex accounts Mission Control widget (plan Task 10). Consumes plugin RPC only —
 * no host `context.accounts` facade. Subscribes to `accounts.changed` BEFORE
 * requesting the initial snapshot, and applies only snapshots whose
 * `revision` exceeds the current one (revision-based stale rejection).
 */

export interface AccountsWidgetProps {
  context: ExternalRendererPluginContext;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function statusVariant(
  status: CodexAccountStatus
): "default" | "destructive" | "outline" | "secondary" {
  switch (status) {
    case "active":
      return "default";
    case "available":
      return "secondary";
    case "login-pending":
      return "outline";
    case "error":
      return "destructive";
    default:
      return "secondary";
  }
}

export function AccountsWidget({ context }: AccountsWidgetProps): JSX.Element {
  const [snapshot, setSnapshot] = useState<CodexAccountsSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const t = (key: string, fallback: string): string =>
    context.i18n.t(key, fallback);

  useEffect(() => {
    let disposed = false;
    let currentRevision = 0;
    setLoadError(null);
    const unsubscribe = context.rpc.on<CodexAccountsSnapshot>(
      "accounts.changed",
      (event) => {
        if (!disposed && event.revision > currentRevision) {
          currentRevision = event.revision;
          setLoadError(null);
          setSnapshot(event);
        }
      }
    );
    context.rpc
      .invoke<CodexAccountsSnapshot>("accounts.snapshot", null)
      .then((initial) => {
        if (!disposed && initial.revision > currentRevision) {
          currentRevision = initial.revision;
          setLoadError(null);
          setSnapshot(initial);
        }
      })
      .catch((err: unknown) => {
        if (!disposed) {
          setLoadError(errorMessage(err));
        }
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [context]);

  if (loadError) {
    return (
      <Alert className="m-3" variant="destructive">
        <AlertTitle>
          {t("pier.codex.accounts.loadFailed", "Could not load Codex accounts")}
        </AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  if (!snapshot) {
    return (
      <div
        aria-label={t("pier.codex.accounts.loading", "Codex accounts loading")}
        className="flex h-full flex-col gap-3 p-3"
        role="status"
      >
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-7 w-28" />
      </div>
    );
  }
  const invoke = (method: string, payload: unknown = null): void => {
    context.rpc.invoke(method, payload).catch((err: unknown) => {
      context.notifications.error(
        `${t(
          "pier.codex.accounts.actionFailed",
          "Codex account action failed"
        )}: ${errorMessage(err)}`
      );
    });
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={snapshot.login !== null}
          onClick={() => invoke("accounts.add", {})}
          size="sm"
          type="button"
        >
          {t("pier.codex.accounts.add", "Add account")}
        </Button>
        <Button
          disabled={snapshot.login !== null}
          onClick={() => invoke("accounts.adoptCurrent", null)}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("pier.codex.accounts.useCurrent", "Use current login")}
        </Button>
        {snapshot.login ? (
          <Button
            onClick={() => invoke("accounts.cancelLogin", null)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("pier.codex.accounts.cancelLogin", "Cancel login")}
          </Button>
        ) : null}
      </div>
      {snapshot.login ? (
        <Alert>
          <AlertTitle>
            {t("pier.codex.accounts.loginPending", "Login in progress")}
          </AlertTitle>
          <AlertDescription>
            {t(
              "pier.codex.accounts.loginPendingDescription",
              "Finish the Codex login flow or cancel it before starting another one."
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {snapshot.accounts.length === 0 ? (
        <Empty className="min-h-32 rounded-none border-0 p-4">
          <EmptyHeader>
            <EmptyTitle>
              {t("pier.codex.accounts.emptyTitle", "No accounts yet")}
            </EmptyTitle>
            <EmptyDescription>
              {t(
                "pier.codex.accounts.emptyDescription",
                "Add a Codex account or adopt the current login to begin."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {snapshot.accounts.map((account) => (
            <li
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2.5 py-2"
              key={account.id}
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium">{account.label}</span>
                  <Badge variant={statusVariant(account.status)}>
                    {t(
                      `pier.codex.accounts.status.${account.status}`,
                      account.status
                    )}
                  </Badge>
                  {account.id === snapshot.activeAccountId ? (
                    <Badge variant="outline">
                      {t("pier.codex.accounts.active", "active")}
                    </Badge>
                  ) : null}
                </div>
                {account.error ? (
                  <p className="mt-1 line-clamp-2 text-destructive text-xs">
                    {account.error}
                  </p>
                ) : null}
              </div>
              {account.id === snapshot.activeAccountId ? null : (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    aria-label={`Switch to ${account.label}`}
                    onClick={() =>
                      invoke("accounts.select", { accountId: account.id })
                    }
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    {t("pier.codex.accounts.switch", "Switch")}
                  </Button>
                  <Button
                    aria-label={`Remove ${account.label}`}
                    onClick={() =>
                      invoke("accounts.remove", { accountId: account.id })
                    }
                    size="xs"
                    type="button"
                    variant="destructive"
                  >
                    {t("pier.codex.accounts.remove", "Remove")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button
        className="mt-auto self-start"
        onClick={() => {
          invoke("accounts.refreshUsage", null);
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        {t("pier.codex.accounts.refreshUsage", "Refresh usage")}
      </Button>
    </div>
  );
}
