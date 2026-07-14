import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { ArrowLeftRight, Settings } from "lucide-react";
import type { JSX } from "react";
import { useState } from "react";
import type {
  CodexAccountSummary,
  CrossToolSyncTarget,
} from "../shared/accounts.ts";
import { SwitchConfirmDialog } from "./account-switch.ts";
import { formatAccountError } from "./format-account-error.ts";

export interface AccountPickerProps {
  accounts: readonly CodexAccountSummary[];
  context: ExternalRendererPluginContext;
  t: (key: string, fallback: string) => string;
}

export function AccountPicker({
  accounts,
  context,
  t,
}: AccountPickerProps): JSX.Element | null {
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(
    null
  );
  const [dialogAccountId, setDialogAccountId] = useState<string | null>(null);
  if (accounts.length === 0) return null;

  const reportError = async (err: unknown): Promise<void> => {
    await context.dialogs.alert({
      title: t("pier.codex.widget.actionFailed", "Account action failed"),
      body: formatAccountError(err, t),
    });
  };

  const handleDialogResult = async ({
    confirmed,
    syncTargets,
  }: {
    confirmed: boolean;
    syncTargets: CrossToolSyncTarget[];
  }): Promise<void> => {
    const accountId = dialogAccountId;
    setDialogAccountId(null);
    if (!(confirmed && accountId)) return;
    setSwitchingAccountId(accountId);
    try {
      await context.rpc.invoke("accounts.select", {
        accountId,
        syncTargets,
      });
    } catch (error) {
      await reportError(error);
    } finally {
      setSwitchingAccountId(null);
    }
  };

  return (
    <>
      <DropdownMenu>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-busy={switchingAccountId !== null || undefined}
                  aria-label={t(
                    "pier.codex.widget.switchAccount",
                    "Switch account"
                  )}
                  disabled={switchingAccountId !== null}
                  size="icon-sm"
                  variant="ghost"
                >
                  {switchingAccountId ? (
                    <Spinner
                      aria-label={t(
                        "pier.codex.widget.switchingAccount",
                        "Switching account"
                      )}
                      data-icon="inline-start"
                    />
                  ) : (
                    <ArrowLeftRight data-icon="inline-start" />
                  )}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent data-pier-codex-scope="">
              {t("pier.codex.widget.switchAccount", "Switch account")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DropdownMenuContent
          align="end"
          data-pier-codex-scope=""
          style={{
            maxWidth: "var(--radix-dropdown-menu-content-available-width)",
            minWidth:
              "min(16rem, var(--radix-dropdown-menu-content-available-width))",
          }}
        >
          <DropdownMenuGroup>
            {accounts.map((account) => (
              <DropdownMenuItem
                key={account.id}
                onSelect={() => {
                  setDialogAccountId(account.id);
                }}
              >
                <span className="min-w-0">
                  <span className="block whitespace-normal break-words">
                    {account.label}
                  </span>
                  {account.planType ? (
                    <span className="block text-muted-foreground text-xs">
                      {account.planType.toUpperCase()}
                    </span>
                  ) : null}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => {
                context.app.openSettings({ section: "plugin:pier.codex" });
              }}
            >
              <Settings />
              {t("pier.codex.widget.manageAccounts", "Manage accounts...")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <SwitchConfirmDialog
        onResult={handleDialogResult}
        open={dialogAccountId !== null}
        t={t}
      />
    </>
  );
}
