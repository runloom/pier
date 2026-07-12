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
import { Check, ChevronDown, Settings } from "lucide-react";
import type { JSX } from "react";
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
  const activeAccount = snapshot.accounts.find(
    (a) => a.id === snapshot.activeAccountId
  );

  const reportError = (err: unknown): void => {
    context.dialogs.alert({
      title: t("pier.codex.widget.actionFailed", "Account action failed"),
      body: err instanceof Error ? err.message : String(err),
    });
  };

  const invoke = (method: string, payload: unknown = null): void => {
    context.rpc.invoke(method, payload).catch(reportError);
  };

  const handleSelect = async (accountId: string): Promise<void> => {
    if (await confirmAccountSwitch(context, t)) {
      invoke("accounts.select", { accountId });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="w-full justify-between font-normal"
          size="sm"
          variant="outline"
        >
          <span className="truncate">
            {activeAccount?.label ??
              t("pier.codex.widget.noActiveAccount", "No active account")}
          </span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[--trigger-width]">
        <DropdownMenuGroup>
          {snapshot.accounts.map((account) => (
            <DropdownMenuItem
              disabled={account.id === snapshot.activeAccountId}
              key={account.id}
              onClick={() => handleSelect(account.id).catch(reportError)}
            >
              {account.id === snapshot.activeAccountId ? <Check /> : null}
              <span className="truncate">{account.label}</span>
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
