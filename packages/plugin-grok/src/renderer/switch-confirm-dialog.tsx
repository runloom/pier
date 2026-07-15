import type {
  ExternalRendererPluginContext,
  RendererPluginContentDialogRenderProps,
} from "@pier/plugin-api/renderer";
import { Button } from "@pier/ui/button.tsx";
import { Checkbox } from "@pier/ui/checkbox.tsx";
import { type JSX, useState } from "react";
import {
  ALL_SYNC_TARGETS,
  type CrossToolSyncTarget,
} from "../shared/accounts.ts";
import type { Translate } from "./format-account-error.ts";

export type PeerSyncDialogMode = "switch" | "sync";

export interface SwitchConfirmResult {
  confirmed: boolean;
  syncTargets: CrossToolSyncTarget[];
}

function SwitchConfirmContent({
  accountKind,
  mode,
  t,
  close,
}: {
  accountKind: "api_key" | "oidc";
  mode: PeerSyncDialogMode;
  t: Translate;
  close: RendererPluginContentDialogRenderProps<SwitchConfirmResult>["close"];
}): JSX.Element {
  // pi has no xAI OAuth support, so OIDC accounts never offer it as a peer target.
  const availableTargets =
    accountKind === "api_key"
      ? ALL_SYNC_TARGETS
      : ALL_SYNC_TARGETS.filter((target) => target !== "pi");
  const [syncTargets, setSyncTargets] = useState<Set<CrossToolSyncTarget>>(
    () => new Set(availableTargets)
  );

  function toggleTarget(target: CrossToolSyncTarget): void {
    setSyncTargets((prev) => {
      const next = new Set(prev);
      if (next.has(target)) {
        next.delete(target);
      } else {
        next.add(target);
      }
      return next;
    });
  }

  const targetLabel: Record<Exclude<CrossToolSyncTarget, "grok">, string> = {
    opencode: t("pier.grok.switch.syncTarget.opencode", "OpenCode"),
    pi: t("pier.grok.switch.syncTarget.pi", "Pi"),
    omp: t("pier.grok.switch.syncTarget.omp", "OMP"),
  };

  const sectionLabel =
    mode === "sync"
      ? t(
          "pier.grok.accounts.settings.syncPeersSectionLabel",
          "Sync the Grok account to:"
        )
      : t(
          "pier.grok.switch.syncSectionLabel",
          "Also switch the Grok account in:"
        );
  const confirmLabel =
    mode === "sync"
      ? t("pier.grok.accounts.settings.syncPeersAction", "Sync")
      : t("pier.grok.accounts.settings.switchConfirmAction", "Confirm");

  return (
    <div className="flex flex-col gap-4" data-pier-grok-scope="">
      <div className="flex flex-col gap-3">
        <p className="font-medium text-sm">{sectionLabel}</p>
        <div className="flex flex-col gap-2">
          {availableTargets.map((target) => {
            const checked = syncTargets.has(target);
            return (
              <label
                className="flex items-center gap-2 text-sm"
                htmlFor={`sync-target-${target}`}
                key={target}
              >
                <Checkbox
                  checked={checked}
                  id={`sync-target-${target}`}
                  onCheckedChange={() => {
                    toggleTarget(target);
                  }}
                />
                <span>{targetLabel[target]}</span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          onClick={() => close({ confirmed: false, syncTargets: [] })}
          type="button"
          variant="outline"
        >
          {t("pier.grok.accounts.settings.cancel", "Cancel")}
        </Button>
        <Button
          disabled={mode === "sync" && syncTargets.size === 0}
          onClick={() =>
            close({ confirmed: true, syncTargets: [...syncTargets] })
          }
          type="button"
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

export async function openSwitchConfirmDialog(options: {
  accountKind: "api_key" | "oidc";
  context: ExternalRendererPluginContext;
  mode?: PeerSyncDialogMode;
  t: Translate;
}): Promise<SwitchConfirmResult> {
  const mode = options.mode ?? "switch";
  const { accountKind, context, t } = options;
  const title =
    mode === "sync"
      ? t(
          "pier.grok.accounts.settings.syncPeersTitle",
          "Sync Grok account to other tools?"
        )
      : t(
          "pier.grok.accounts.settings.switchConfirmTitle",
          "Switch Grok account?"
        );
  const description =
    mode === "sync"
      ? t(
          "pier.grok.accounts.settings.syncPeersBody",
          "Write this Grok account's xAI credentials into the selected tools. Already-running sessions in those tools may need a restart."
        )
      : t(
          "pier.grok.accounts.settings.switchConfirmBody",
          "New Grok sessions will use this account. Restart any Grok sessions that are already running for the change to take effect."
        );

  const handle = context.dialogs.open<SwitchConfirmResult>({
    id: mode === "sync" ? "accounts.sync-confirm" : "accounts.switch-confirm",
    title,
    description,
    size: "sm",
    content: (props) => (
      <SwitchConfirmContent
        accountKind={accountKind}
        close={props.close}
        mode={mode}
        t={t}
      />
    ),
  });
  const result = await handle.result;
  return result ?? { confirmed: false, syncTargets: [] };
}
