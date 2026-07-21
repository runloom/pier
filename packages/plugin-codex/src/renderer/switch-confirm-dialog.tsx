import {
  notifyPeerSyncFailures as notifySharedPeerSyncFailures,
  partitionPeerTargets,
} from "@pier/plugin-api/peer-sync";
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
  EMPTY_PEER_AVAILABILITY,
  type PeerAvailability,
  type PeerSyncTarget,
} from "../shared/accounts.ts";
import type { Translate } from "./usage-meter.tsx";

export type PeerSyncDialogMode = "switch" | "sync";

export interface SwitchConfirmResult {
  confirmed: boolean;
  syncTargets: CrossToolSyncTarget[];
}

function isPeerAvailability(value: unknown): value is PeerAvailability {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.omp === "boolean" &&
    typeof record.opencode === "boolean" &&
    typeof record.pi === "boolean"
  );
}

export async function loadPeerAvailability(
  context: ExternalRendererPluginContext
): Promise<PeerAvailability> {
  try {
    const result = await context.rpc.invoke<unknown>(
      "accounts.peerAvailability",
      null
    );
    // Fail closed on missing/malformed probes (tests often stub unknown RPCs as null).
    return isPeerAvailability(result) ? result : EMPTY_PEER_AVAILABILITY;
  } catch {
    // Fail closed: do not default-select peers we could not probe.
    return EMPTY_PEER_AVAILABILITY;
  }
}

/**
 * Surface partial peer-sync failures from an `accounts.select` result.
 * Thin wrapper over the shared helper with this plugin's i18n prefix.
 */
export function notifyPeerSyncFailures(
  context: ExternalRendererPluginContext,
  t: Translate,
  selectResult: unknown
): void {
  notifySharedPeerSyncFailures({
    context,
    i18nPrefix: "pier.codex",
    selectResult,
    t,
  });
}

function SwitchConfirmContent({
  availability,
  mode,
  t,
  close,
}: {
  availability: PeerAvailability;
  mode: PeerSyncDialogMode;
  t: Translate;
  close: RendererPluginContentDialogRenderProps<SwitchConfirmResult>["close"];
}): JSX.Element {
  const { available } = partitionPeerTargets(ALL_SYNC_TARGETS, availability);
  const showSyncSection = available.length > 0;
  // Switch defaults to unchecked: overwriting credentials in other tools the
  // user may have deliberately pointed at a different account must be opt-in.
  // The dedicated sync action is explicit intent, so it preselects all.
  const [syncTargets, setSyncTargets] = useState<Set<CrossToolSyncTarget>>(
    () => (mode === "sync" ? new Set(available) : new Set())
  );

  function toggleTarget(target: CrossToolSyncTarget): void {
    setSyncTargets((prev) => {
      const next = new Set(prev);
      if (next.has(target)) next.delete(target);
      else next.add(target);
      return next;
    });
  }

  const targetLabel: Record<PeerSyncTarget, string> = {
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
      {showSyncSection ? (
        <div className="flex flex-col gap-3">
          <p className="font-medium text-sm">{sectionLabel}</p>
          <div className="flex flex-col gap-2">
            {available.map((target) => {
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
      ) : null}
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
  const availability = await loadPeerAvailability(context);
  const { available } = partitionPeerTargets(ALL_SYNC_TARGETS, availability);

  // Dedicated sync entry with no installed peers should not open an empty dialog.
  // The settings Share button is hidden in that case; keep this as a silent guard.
  if (mode === "sync" && available.length === 0) {
    return { confirmed: false, syncTargets: [] };
  }

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

  // No peer checkboxes → plain confirm. Custom content is only for multi-select.
  if (available.length === 0) {
    const confirmed = await context.dialogs.confirm({
      body: description,
      intent: "default",
      size: "sm",
      title,
    });
    return { confirmed, syncTargets: [] };
  }

  const handle = context.dialogs.open<SwitchConfirmResult>({
    id: mode === "sync" ? "accounts.sync-confirm" : "accounts.switch-confirm",
    title,
    description,
    size: "sm",
    content: (props) => (
      <SwitchConfirmContent
        availability={availability}
        close={props.close}
        mode={mode}
        t={t}
      />
    ),
  });
  const result = await handle.result;
  return result ?? { confirmed: false, syncTargets: [] };
}
