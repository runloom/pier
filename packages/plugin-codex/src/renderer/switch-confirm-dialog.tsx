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
import type { Translate } from "./usage-meter.tsx";

export type PeerSyncDialogMode = "switch" | "sync";

export interface SwitchConfirmResult {
  confirmed: boolean;
  syncTargets: CrossToolSyncTarget[];
}

function SwitchConfirmContent({
  mode,
  t,
  close,
}: {
  mode: PeerSyncDialogMode;
  t: Translate;
  close: RendererPluginContentDialogRenderProps<SwitchConfirmResult>["close"];
}): JSX.Element {
  const [syncTargets, setSyncTargets] = useState<Set<CrossToolSyncTarget>>(
    () => new Set(ALL_SYNC_TARGETS)
  );

  function toggleTarget(target: CrossToolSyncTarget): void {
    setSyncTargets((prev) => {
      const next = new Set(prev);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  }

  const targetLabel: Record<Exclude<CrossToolSyncTarget, "codex">, string> = {
    opencode: t("pier.codex.switch.syncTarget.opencode", "OpenCode"),
    pi: t("pier.codex.switch.syncTarget.pi", "Pi"),
    omp: t("pier.codex.switch.syncTarget.omp", "OMP"),
  };

  const sectionLabel =
    mode === "sync"
      ? t(
          "pier.codex.accounts.settings.syncPeersSectionLabel",
          "Sync the OpenAI account to:"
        )
      : t(
          "pier.codex.switch.syncSectionLabel",
          "Also switch the OpenAI account in:"
        );
  const confirmLabel =
    mode === "sync"
      ? t("pier.codex.accounts.settings.syncPeersAction", "Sync")
      : t("pier.codex.accounts.settings.switchConfirmAction", "Confirm");

  return (
    <div className="flex flex-col gap-4" data-pier-codex-scope="">
      <div className="flex flex-col gap-3">
        <p className="font-medium text-sm">{sectionLabel}</p>
        <div className="flex flex-col gap-2">
          {ALL_SYNC_TARGETS.map((target) => {
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
          {t("pier.codex.accounts.settings.cancel", "Cancel")}
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
  context: ExternalRendererPluginContext;
  mode?: PeerSyncDialogMode;
  t: Translate;
}): Promise<SwitchConfirmResult> {
  const mode = options.mode ?? "switch";
  const { context, t } = options;
  const title =
    mode === "sync"
      ? t(
          "pier.codex.accounts.settings.syncPeersTitle",
          "Sync OpenAI account to other tools?"
        )
      : t(
          "pier.codex.accounts.settings.switchConfirmTitle",
          "Switch Codex account?"
        );
  const description =
    mode === "sync"
      ? t(
          "pier.codex.accounts.settings.syncPeersBody",
          "Write this Codex account's OpenAI credentials into the selected tools. Already-running sessions in those tools may need a restart."
        )
      : t(
          "pier.codex.accounts.settings.switchConfirmBody",
          "New Codex sessions will use this account. Restart any Codex sessions that are already running for the change to take effect."
        );

  const handle = context.dialogs.open<SwitchConfirmResult>({
    id: mode === "sync" ? "accounts.sync-confirm" : "accounts.switch-confirm",
    title,
    description,
    size: "sm",
    content: (props) => (
      <SwitchConfirmContent close={props.close} mode={mode} t={t} />
    ),
  });
  const result = await handle.result;
  return result ?? { confirmed: false, syncTargets: [] };
}
