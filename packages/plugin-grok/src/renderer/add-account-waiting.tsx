import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
} from "@pier/ui/item.tsx";
import { Spinner } from "@pier/ui/spinner.tsx";
import { ExternalLink } from "lucide-react";
import type { JSX } from "react";
import type { Translate } from "./format-account-error.ts";

/** Waiting-stage body only — parent owns sticky footer (single setFooter owner). */
export function AddAccountWaiting({
  deviceCode,
  deviceVerificationUrl,
  onOpenVerificationUrl,
  t,
}: {
  deviceCode?: string | undefined;
  deviceVerificationUrl?: string | undefined;
  loginActive?: boolean;
  onCancel?: () => void;
  onOpenVerificationUrl?: (url: string) => void;
  onRestart?: () => void;
  pendingAction?: "cancel" | "restart" | null;
  t: Translate;
}): JSX.Element {
  const hasDeviceInfo = Boolean(deviceCode || deviceVerificationUrl);

  return (
    <div
      className="flex flex-col gap-4"
      data-pier-grok-scope=""
      data-slot="dialog-commit-form"
    >
      <Item size="sm" variant="muted">
        <ItemMedia variant="icon">
          <Spinner />
        </ItemMedia>
        <ItemContent>
          <ItemDescription>
            {t(
              "pier.grok.accounts.settings.addDialogWaitingStatus",
              "Waiting for Grok authorization…"
            )}
          </ItemDescription>
        </ItemContent>
      </Item>
      {hasDeviceInfo ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p className="text-muted-foreground text-xs">
            {t(
              "pier.grok.accounts.settings.addDialogDeviceOpen",
              "Open the verification page and enter the code below"
            )}
          </p>
          {deviceVerificationUrl ? (
            <button
              className="inline-flex select-text items-center gap-1 break-all text-left text-primary text-sm underline underline-offset-2"
              onClick={() => onOpenVerificationUrl?.(deviceVerificationUrl)}
              type="button"
            >
              {deviceVerificationUrl}
              <ExternalLink aria-hidden className="size-3.5 shrink-0" />
            </button>
          ) : null}
          {deviceCode ? (
            <code
              className="select-all font-mono text-lg tracking-widest"
              data-testid="grok-device-code"
            >
              {deviceCode}
            </code>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
