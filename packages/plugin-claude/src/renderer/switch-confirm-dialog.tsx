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
import type { Translate } from "./format-account-error.ts";

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
    typeof record.pi === "boolean" &&
    typeof record.piOauthCapable === "boolean"
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
    return isPeerAvailability(result) ? result : EMPTY_PEER_AVAILABILITY;
  } catch {
    return EMPTY_PEER_AVAILABILITY;
  }
}

export function notifyPeerSyncFailures(
  context: ExternalRendererPluginContext,
  t: Translate,
  selectResult: unknown
): void {
  notifySharedPeerSyncFailures({
    context,
    i18nPrefix: "pier.claude",
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
  // Anthropic OAuth works on all pi versions that accept oauth entries;
  // install readiness (`pi`) is enough — no xAI-style version gate.
  const { available } = partitionPeerTargets(ALL_SYNC_TARGETS, availability);
  const showSyncSection = available.length > 0;
  const [syncTargets, setSyncTargets] = useState<Set<CrossToolSyncTarget>>(
    () => (mode === "sync" ? new Set(available) : new Set())
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

  const targetLabel: Record<PeerSyncTarget, string> = {
    opencode: t("pier.claude.switch.syncTarget.opencode", "OpenCode"),
    pi: t("pier.claude.switch.syncTarget.pi", "Pi"),
    omp: t("pier.claude.switch.syncTarget.omp", "OMP"),
  };

  const sectionLabel =
    mode === "sync"
      ? t(
          "pier.claude.accounts.settings.syncPeersSectionLabel",
          "Sync the Claude account to:"
        )
      : t(
          "pier.claude.switch.syncSectionLabel",
          "Also switch the Claude account in:"
        );
  const confirmLabel =
    mode === "sync"
      ? t("pier.claude.accounts.settings.syncPeersAction", "Sync")
      : t("pier.claude.accounts.settings.switchConfirmAction", "Confirm");

  return (
    <div className="flex flex-col gap-4" data-pier-claude-scope="">
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
          {t("pier.claude.accounts.settings.cancel", "Cancel")}
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

  if (mode === "sync" && available.length === 0) {
    return { confirmed: false, syncTargets: [] };
  }

  const title =
    mode === "sync"
      ? t(
          "pier.claude.accounts.settings.syncPeersTitle",
          "Sync Claude account to other tools?"
        )
      : t(
          "pier.claude.accounts.settings.switchConfirmTitle",
          "Switch Claude account?"
        );
  const description =
    mode === "sync"
      ? t(
          "pier.claude.accounts.settings.syncPeersBody",
          "Write this Claude account's credentials into the selected tools. Already-running sessions in those tools may need a restart."
        )
      : t(
          "pier.claude.accounts.settings.switchConfirmBody",
          "New Claude sessions will use this account. Restart any Claude sessions that are already running for the change to take effect."
        );

  if (available.length === 0) {
    const confirmed = await context.dialogs.confirm({
      body: description,
      intent: "default",
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
