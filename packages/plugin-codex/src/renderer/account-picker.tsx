import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import { ChevronDown } from "lucide-react";
import type { JSX } from "react";
import type { CodexAccountsSnapshot } from "../shared/accounts.ts";

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
  const isSystemDefault = snapshot.activeAccountId === null;
  const activeAccount = snapshot.accounts.find(
    (a) => a.id === snapshot.activeAccountId
  );

  const invoke = (method: string, payload: unknown = null): void => {
    context.rpc.invoke(method, payload).catch((err: unknown) => {
      context.notifications.error(
        `${t(
          "pier.codex.widget.actionFailed",
          "Account action failed"
        )}: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  };

  const handleSelect = (accountId: string): void => {
    invoke("accounts.select", { accountId });
  };

  const handleSelectSystemDefault = (): void => {
    invoke("accounts.selectSystemDefault", null);
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
            {isSystemDefault
              ? t("pier.codex.widget.systemDefault", "System default")
              : (activeAccount?.label ??
                t("pier.codex.widget.systemDefault", "System default"))}
          </span>
          <ChevronDown className="ml-1 size-3.5 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[--trigger-width]">
        {/* System default option */}
        <DropdownMenuItem
          className={isSystemDefault ? "font-medium" : ""}
          onClick={handleSelectSystemDefault}
        >
          <div className="flex w-full items-center justify-between gap-2">
            <span>
              {t("pier.codex.widget.systemDefault", "System default")}
            </span>
            {isSystemDefault ? (
              <span className="text-muted-foreground text-xs">
                {t("pier.codex.widget.current", "Current")}
              </span>
            ) : null}
          </div>
        </DropdownMenuItem>

        {snapshot.accounts.length > 0 ? <DropdownMenuSeparator /> : null}

        {/* Managed accounts */}
        {snapshot.accounts.map((account) => (
          <DropdownMenuItem
            className={
              account.id === snapshot.activeAccountId ? "font-medium" : ""
            }
            key={account.id}
            onClick={() => {
              if (account.id !== snapshot.activeAccountId) {
                handleSelect(account.id);
              }
            }}
          >
            <div className="flex w-full items-center justify-between gap-2">
              <span className="truncate">{account.label}</span>
              {account.id === snapshot.activeAccountId ? (
                <span className="text-muted-foreground text-xs">
                  {t("pier.codex.widget.current", "Current")}
                </span>
              ) : null}
            </div>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            context.app.openSettings({ section: "plugin:pier.codex" });
          }}
        >
          <span className="text-muted-foreground">
            {t("pier.codex.widget.manageAccounts", "Manage accounts...")}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
