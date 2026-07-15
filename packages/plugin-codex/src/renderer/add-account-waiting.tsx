import { Button } from "@pier/ui/button.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
} from "@pier/ui/item.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import type { JSX } from "react";
import type { Translate } from "./usage-meter.tsx";

export function AddAccountWaiting({
  loginActive,
  onCancel,
  onRestart,
  pendingAction,
  t,
}: {
  loginActive: boolean;
  onCancel: () => void;
  onRestart: () => void;
  pendingAction: "cancel" | "restart" | null;
  t: Translate;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4" data-pier-codex-scope="">
      <Item size="sm" variant="muted">
        <ItemMedia variant="icon">
          <Spinner />
        </ItemMedia>
        <ItemContent>
          <ItemDescription>
            {t(
              "pier.codex.accounts.settings.addDialogWaitingStatus",
              "Waiting for Codex authorization…"
            )}
          </ItemDescription>
        </ItemContent>
      </Item>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          aria-busy={pendingAction === "cancel" || undefined}
          disabled={pendingAction !== null || !loginActive}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          {pendingAction === "cancel" ? (
            <Spinner data-icon="inline-start" />
          ) : null}
          {t("pier.codex.accounts.settings.cancelLogin", "Cancel login")}
        </Button>
        <Button
          aria-busy={pendingAction === "restart" || undefined}
          disabled={pendingAction !== null || !loginActive}
          onClick={onRestart}
          type="button"
          variant="secondary"
        >
          {pendingAction === "restart" ? (
            <Spinner data-icon="inline-start" />
          ) : null}
          {t(
            "pier.codex.accounts.settings.addDialogReopenBrowser",
            "Reopen browser"
          )}
        </Button>
      </div>
    </div>
  );
}
