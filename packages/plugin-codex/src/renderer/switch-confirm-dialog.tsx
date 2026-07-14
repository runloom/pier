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

export interface SwitchConfirmResult {
  confirmed: boolean;
  syncTargets: CrossToolSyncTarget[];
}

/**
 * Account switch confirmation dialog with cross-tool sync checkboxes.
 *
 * Renders a Dialog (same pattern as AddAccountDialog) because the external
 * plugin `dialogs.confirm` API only supports plain text body — no custom
 * content like checkboxes. The dialog shows the standard switch warning plus
 * a list of peer tools (opencode / pi / omp) with checkboxes, all selected
 * by default. The user can deselect tools they don't want synced.
 */
export function SwitchConfirmDialog({
  open,
  onResult,
  t,
}: {
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

  const targetLabel: Record<CrossToolSyncTarget, string> = {
    codex: "Codex",
    opencode: t("pier.codex.switch.syncTarget.opencode", "OpenCode"),
    pi: t("pier.codex.switch.syncTarget.pi", "pi"),
    omp: t("pier.codex.switch.syncTarget.omp", "omp"),
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleCancel();
      }}
      open={open}
    >
      <DialogContent data-pier-codex-scope="">
        <DialogHeader>
          <DialogTitle>
            {t(
              "pier.codex.accounts.settings.switchConfirmTitle",
              "Switch Codex account?"
            )}
          </DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">
            {t(
              "pier.codex.accounts.settings.switchConfirmBody",
              "New Codex sessions will use this account. Restart any Codex sessions that are already running for the change to take effect."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 py-2">
          <p className="text-foreground-muted text-sm">
            {t(
              "pier.codex.switch.syncSectionLabel",
              "Also switch the OpenAI account in:"
            )}
          </p>
          <div className="flex flex-col gap-1" data-testid="sync-targets">
            {ALL_SYNC_TARGETS.map((target) => (
              <button
                className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/50"
                key={target}
                onClick={() => toggleTarget(target)}
                type="button"
              >
                <Checkbox
                  checked={syncTargets.has(target)}
                  data-testid={`sync-target-${target}`}
                  onCheckedChange={() => toggleTarget(target)}
                />
                <span className="text-sm">{targetLabel[target]}</span>
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleCancel} type="button" variant="outline">
            {t("pier.codex.accounts.settings.cancel", "Cancel")}
          </Button>
          <Button onClick={handleConfirm} type="button" variant="default">
            <Check data-icon="inline-start" />
            {t("pier.codex.accounts.settings.switch", "Switch")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
