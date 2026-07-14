import { Button } from "@pier/ui/button.tsx";
import { Checkbox } from "@pier/ui/checkbox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pier/ui/dialog.tsx";
import { Check } from "lucide-react";
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

/**
 * Confirmation dialog with peer-tool checkboxes.
 *
 * - `switch`: confirm Codex account switch + optional peer mirror
 * - `sync`: mirror the current managed account into peers only
 */
export function SwitchConfirmDialog({
  mode = "switch",
  open,
  onResult,
  t,
}: {
  mode?: PeerSyncDialogMode;
  open: boolean;
  onResult: (result: SwitchConfirmResult) => void;
  t: Translate;
}): JSX.Element {
  const [syncTargets, setSyncTargets] = useState<Set<CrossToolSyncTarget>>(
    () => new Set(ALL_SYNC_TARGETS)
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

  function handleConfirm(): void {
    onResult({ confirmed: true, syncTargets: [...syncTargets] });
  }

  function handleCancel(): void {
    onResult({ confirmed: false, syncTargets: [] });
  }

  const targetLabel: Record<Exclude<CrossToolSyncTarget, "codex">, string> = {
    opencode: t("pier.codex.switch.syncTarget.opencode", "OpenCode"),
    pi: t("pier.codex.switch.syncTarget.pi", "pi"),
    omp: t("pier.codex.switch.syncTarget.omp", "omp"),
  };

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
  const body =
    mode === "sync"
      ? t(
          "pier.codex.accounts.settings.syncPeersBody",
          "Write this Codex account's OpenAI credentials into the selected tools. Already-running sessions in those tools may need a restart."
        )
      : t(
          "pier.codex.accounts.settings.switchConfirmBody",
          "New Codex sessions will use this account. Restart any Codex sessions that are already running for the change to take effect."
        );
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
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleCancel();
      }}
      open={open}
    >
      <DialogContent data-pier-codex-scope="">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <DialogDescription className="whitespace-pre-wrap">
            {body}
          </DialogDescription>
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">{sectionLabel}</p>
            <div className="flex flex-col gap-1" data-testid="sync-targets">
              {ALL_SYNC_TARGETS.map((target) => {
                const checkboxId = `pier-codex-sync-target-${target}`;
                return (
                  <div
                    className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/50"
                    key={target}
                  >
                    <Checkbox
                      checked={syncTargets.has(target)}
                      data-testid={`sync-target-${target}`}
                      id={checkboxId}
                      onCheckedChange={() => toggleTarget(target)}
                    />
                    <label
                      className="flex-1 cursor-pointer text-sm"
                      htmlFor={checkboxId}
                    >
                      {targetLabel[target]}
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleCancel} type="button" variant="outline">
            {t("pier.codex.accounts.settings.cancel", "Cancel")}
          </Button>
          <Button
            disabled={syncTargets.size === 0 && mode === "sync"}
            onClick={handleConfirm}
            type="button"
            variant="default"
          >
            <Check data-icon="inline-start" />
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
