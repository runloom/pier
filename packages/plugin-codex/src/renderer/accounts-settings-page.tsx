import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Alert, AlertDescription, AlertTitle } from "@pier/ui/alert.tsx";
import { Badge } from "@pier/ui/badge.tsx";
import { Button } from "@pier/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@pier/ui/card.tsx";
import { Switch } from "@pier/ui/switch.tsx";
import type { JSX } from "react";
import type { CodexAccountStatus } from "../shared/accounts.ts";
import { useCodexAccountsSnapshot } from "./use-accounts-snapshot.ts";

export interface AccountsSettingsPageProps {
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

const CONFIRM_SWITCH_KEY = "pier.codex.confirmSwitch";

export function AccountsSettingsPage({
  context,
}: AccountsSettingsPageProps): JSX.Element {
  const { error: loadError, snapshot } = useCodexAccountsSnapshot(context);
  const t = (key: string, fallback: string): string =>
    context.i18n.t(key, fallback);
  const confirmSwitch = context.configuration.get<boolean>(CONFIRM_SWITCH_KEY);

  const invoke = (method: string, payload: unknown = null): void => {
    context.rpc.invoke(method, payload).catch((err: unknown) => {
      context.notifications.error(
        `${t(
          "pier.codex.accounts.settings.actionFailed",
          "Account action failed"
        )}: ${errorMessage(err)}`
      );
    });
  };

  const handleSelectSystemDefault = async (): Promise<void> => {
    if (confirmSwitch) {
      const ok = await context.dialogs.confirm({
        title: t(
          "pier.codex.accounts.settings.confirmSwitchSystemDefaultTitle",
          "Switch to system default?"
        ),
        body: t(
          "pier.codex.accounts.settings.confirmSwitchSystemDefaultBody",
          "This will switch to the system default Codex installation."
        ),
        intent: "default",
      });
      if (!ok) return;
    }
    invoke("accounts.selectSystemDefault", null);
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

  const handleSelect = async (accountId: string): Promise<void> => {
    if (confirmSwitch) {
      const ok = await context.dialogs.confirm({
        title: t(
          "pier.codex.accounts.settings.confirmSwitchAccountTitle",
          "Switch account?"
        ),
        intent: "default",
      });
      if (!ok) return;
    }
    invoke("accounts.select", { accountId });
  };

  const handleToggleConfirmSwitch = (checked: boolean): void => {
    context.configuration.set(CONFIRM_SWITCH_KEY, checked);
  };

  if (loadError) {
    return (
      <div className="p-6">
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
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground text-sm">
              {t("pier.codex.accounts.settings.loading", "Loading...")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isSystemDefault = snapshot.activeAccountId === null;
  const hasAccounts = snapshot.accounts.length > 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("pier.codex.accounts.settings.title", "Codex Accounts")}
          </CardTitle>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t(
              "pier.codex.accounts.settings.description1",
              "Manage your Codex accounts. The active account is used for AI conversations."
            )}
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t(
              "pier.codex.accounts.settings.description2",
              "Your login stays on this device. Accounts are materialized from your local Codex installation."
            )}
          </p>
        </CardHeader>
      </Card>

      {/* Accounts */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>
            {t("pier.codex.accounts.settings.accounts", "Accounts")}
          </CardTitle>
          <Button
            disabled={snapshot.login !== null}
            onClick={() => invoke("accounts.add", {})}
            size="sm"
            type="button"
          >
            {t("pier.codex.accounts.settings.addAccount", "Add account")}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Login in progress */}
          {snapshot.login ? (
            <Alert>
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
                className="mt-2"
                onClick={() => invoke("accounts.cancelLogin", null)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("pier.codex.accounts.settings.cancelLogin", "Cancel login")}
              </Button>
            </Alert>
          ) : null}

          {/* System default card */}
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-background px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium text-sm">
                  {t(
                    "pier.codex.accounts.settings.systemDefault",
                    "System default"
                  )}
                </span>
                {isSystemDefault ? (
                  <Badge variant="outline">
                    {t("pier.codex.accounts.settings.currentBadge", "Current")}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-muted-foreground text-xs">
                {t(
                  "pier.codex.accounts.settings.systemDefaultDesc",
                  "Uses your local Codex installation. No additional configuration needed."
                )}
              </p>
            </div>
            {isSystemDefault ? null : (
              <Button
                onClick={() => {
                  handleSelectSystemDefault().catch((err: unknown) => {
                    context.notifications.error(
                      `${t("pier.codex.accounts.settings.actionFailed", "Account action failed")}: ${errorMessage(err)}`
                    );
                  });
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("pier.codex.accounts.settings.switch", "Switch")}
              </Button>
            )}
          </div>

          {/* Managed accounts list or empty state */}
          {hasAccounts ? (
            <ul className="flex flex-col gap-2">
              {snapshot.accounts.map((account) => (
                <li
                  className="flex items-center gap-2 rounded-lg border bg-background px-4 py-3"
                  key={account.id}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-sm">
                        {account.label}
                      </span>
                      <Badge variant={statusVariant(account.status)}>
                        {t(
                          `pier.codex.accounts.settings.status.${account.status}`,
                          account.status
                        )}
                      </Badge>
                      {account.id === snapshot.activeAccountId ? (
                        <Badge variant="outline">
                          {t(
                            "pier.codex.accounts.settings.currentBadge",
                            "Current"
                          )}
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
                        aria-label={`${t("pier.codex.accounts.settings.switch", "Switch")} ${account.label}`}
                        onClick={() => {
                          handleSelect(account.id).catch((err: unknown) => {
                            context.notifications.error(
                              `${t("pier.codex.accounts.settings.actionFailed", "Account action failed")}: ${errorMessage(err)}`
                            );
                          });
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {t("pier.codex.accounts.settings.switch", "Switch")}
                      </Button>
                      <Button
                        aria-label={`${t("pier.codex.accounts.settings.remove", "Remove")} ${account.label}`}
                        onClick={() => {
                          handleRemove(account.id).catch((err: unknown) => {
                            context.notifications.error(
                              `${t("pier.codex.accounts.settings.actionFailed", "Account action failed")}: ${errorMessage(err)}`
                            );
                          });
                        }}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        {t("pier.codex.accounts.settings.remove", "Remove")}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center">
              <p className="text-muted-foreground text-sm">
                {t(
                  "pier.codex.accounts.settings.emptyTitle",
                  "No managed accounts"
                )}
              </p>
              <p className="text-muted-foreground text-xs">
                {t(
                  "pier.codex.accounts.settings.emptyDesc",
                  "Add a Codex account or adopt the current login to get started."
                )}
              </p>
            </div>
          )}

          {/* Adopt current login (secondary) */}
          <Button
            disabled={snapshot.login !== null}
            onClick={() => invoke("accounts.adoptCurrent", null)}
            size="sm"
            type="button"
            variant="outline"
          >
            {t(
              "pier.codex.accounts.settings.adoptCurrent",
              "Adopt current login"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <p className="font-medium text-sm">
              {t(
                "pier.codex.accounts.settings.confirmSwitchLabel",
                "Confirm before switching"
              )}
            </p>
            <p className="text-muted-foreground text-xs">
              {t(
                "pier.codex.accounts.settings.confirmSwitchDesc",
                "Show a confirmation dialog before switching to another account."
              )}
            </p>
          </div>
          <Switch
            checked={confirmSwitch}
            onCheckedChange={handleToggleConfirmSwitch}
          />
        </CardContent>
      </Card>
    </div>
  );
}
