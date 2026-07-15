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
import type { GrokAccountSummary } from "../shared/accounts.ts";
import { accountDisplayLabel } from "./account-display.tsx";
import { openSwitchConfirmDialog } from "./account-switch.ts";
import { formatAccountError, type Translate } from "./format-account-error.ts";

export interface AccountPickerProps {
  accounts: readonly GrokAccountSummary[];
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
      title: t("pier.grok.widget.actionFailed", "Account action failed"),
      body: formatAccountError(err, t),
    });
  };

  const handleSelectAccount = async (accountId: string): Promise<void> => {
    const result = await openSwitchConfirmDialog({
      context,
      mode: "switch",
      t,
    });
    if (!result.confirmed) {
      return;
    }
    setSwitchingAccountId(accountId);
    try {
      await context.rpc.invoke("accounts.select", {
        accountId,
        syncTargets: result.syncTargets.filter((target) => target !== "grok"),
      });
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
                aria-label={t(
                  "pier.grok.widget.switchAccount",
                  "Switch account"
                )}
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
          <TooltipContent data-pier-grok-scope="">
            {t("pier.grok.widget.switchAccount", "Switch account")}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent
        align="end"
        data-pier-grok-scope=""
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
                  {account.kind === "api_key" ? "API key" : "OIDC"}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() => {
              context.app.openSettings({ section: "plugin:pier.grok" });
            }}
          >
            <Settings />
            {t("pier.grok.widget.manageAccounts", "Manage accounts...")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
