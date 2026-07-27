import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
} from "@pier/ui/item.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import type { JSX } from "react";
import type { Translate } from "./usage-meter.tsx";

/** Waiting-stage body only — parent owns sticky footer (single setFooter owner). */
export function AddAccountWaiting({
  t,
}: {
  loginActive?: boolean;
  onCancel?: () => void;
  onRestart?: () => void;
  pendingAction?: "cancel" | "restart" | null;
  t: Translate;
}): JSX.Element {
  return (
    <div
      className="flex flex-col gap-4"
      data-pier-codex-scope=""
      data-slot="dialog-commit-form"
    >
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
    </div>
  );
}
