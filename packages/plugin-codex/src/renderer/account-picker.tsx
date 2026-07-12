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
import { ArrowLeftRight, Check, Settings } from "lucide-react";
import type { JSX } from "react";
import { useState } from "react";
import type { CodexAccountsSnapshot } from "../shared/accounts.ts";
import { confirmAccountSwitch } from "./account-switch.ts";

export interface AccountPickerProps {
  context: ExternalRendererPluginContext;
  snapshot: CodexAccountsSnapshot;
  t: (key: string, fallback: string) => string;
}

export function AccountPicker({
  context,
  snapshot,
  t,
}: AccountPickerProps): JSX.Element {
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(
    null
  );
  const reportError = async (err: unknown): Promise<void> => {
    await context.dialogs.alert({
      title: t("pier.codex.widget.actionFailed", "Account action failed"),
      body: err instanceof Error ? err.message : String(err),
    });
  };

  const handleSelect = async (accountId: string): Promise<void> => {
    if (!(await confirmAccountSwitch(context, t))) return;
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
                ) : null}
                <ArrowLeftRight data-icon="inline-start" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {t("pier.codex.widget.switchAccount", "Switch account")}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" className="codex:min-w-64">
        <DropdownMenuGroup>
          {snapshot.accounts.map((account) => (
            <DropdownMenuItem
              disabled={account.id === snapshot.activeAccountId}
              key={account.id}
              onClick={() => {
                handleSelect(account.id).catch(reportError);
              }}
            >
              {account.id === snapshot.activeAccountId ? <Check /> : null}
              <span className="codex:min-w-0">
                <span className="codex:block codex:truncate">
                  {account.label}
                </span>
                {account.planType ? (
                  <span className="codex:block codex:text-muted-foreground codex:text-xs">
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
            onClick={() => {
              context.app.openSettings({ section: "plugin:pier.codex" });
            }}
          >
            <Settings />
            {t("pier.codex.widget.manageAccounts", "Manage accounts...")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
