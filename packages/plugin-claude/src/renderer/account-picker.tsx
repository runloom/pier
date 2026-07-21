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
import { type JSX, useState } from "react";
import type { ClaudeAccountSummary } from "../shared/accounts.ts";
import {
  accountDisplayLabel,
  accountMembershipSummary,
} from "./account-display.tsx";
import { confirmSwitch } from "./account-switch.ts";
import { formatAccountError, type Translate } from "./format-account-error.ts";

export interface AccountPickerProps {
  accounts: readonly ClaudeAccountSummary[];
  context: ExternalRendererPluginContext;
  t: Translate;
}

export function AccountPicker({
  accounts,
  context,
  t,
}: AccountPickerProps): JSX.Element | null {
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(
    null
  );
  if (accounts.length === 0) {
    return null;
  }

  const reportError = async (err: unknown): Promise<void> => {
    await context.dialogs.alert({
      title: t("pier.claude.widget.actionFailed", "Account action failed"),
      body: formatAccountError(err, t),
    });
  };

  const handleSelectAccount = async (accountId: string): Promise<void> => {
    const confirmed = await confirmSwitch({ context, t });
    if (!confirmed) {
      return;
    }
    setSwitchingAccountId(accountId);
    try {
      await context.rpc.invoke("accounts.select", { accountId });
    } catch (error) {
      await reportError(error);
    } finally {
      setSwitchingAccountId(null);
    }
  };

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                aria-busy={switchingAccountId !== null || undefined}
                aria-label={
                  switchingAccountId
                    ? t(
                        "pier.claude.widget.switchingAccount",
                        "Switching account…"
                      )
                    : t("pier.claude.widget.switchAccount", "Switch account")
                }
                disabled={switchingAccountId !== null}
                size="icon-sm"
                variant="ghost"
              >
                {switchingAccountId ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <ArrowLeftRight data-icon="inline-start" />
                )}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent data-pier-claude-scope="">
            {switchingAccountId
              ? t("pier.claude.widget.switchingAccount", "Switching account…")
              : t("pier.claude.widget.switchAccount", "Switch account")}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent
        align="end"
        data-pier-claude-scope=""
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
                handleSelectAccount(account.id).catch(() => undefined);
              }}
            >
              <span className="min-w-0">
                <span className="block whitespace-normal break-words">
                  {accountDisplayLabel(account)}
                </span>
                <span className="block text-muted-foreground text-xs">
                  {accountMembershipSummary(
                    account,
                    context.i18n.language(),
                    t
                  )}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() => {
              context.app.openSettings({ section: "plugin:pier.claude" });
            }}
          >
            <Settings />
            {t("pier.claude.widget.manageAccounts", "Manage accounts...")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
