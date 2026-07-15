import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { AppQuitConfirmationMode } from "@shared/contracts/preferences.ts";
import type { TaskRunsSnapshot } from "@shared/contracts/tasks.ts";
import type { AppWindow } from "../windows/app-window.ts";
import {
  type QuitActivitySummary,
  shouldConfirmBeforeQuit,
  summarizeDangerousQuitActivities,
} from "./quit-decision.ts";

export type QuitPhase = "idle" | "confirming" | "preparing" | "quitting";

export interface PreventableQuitEvent {
  preventDefault(): void;
}

export interface AppQuitControllerDeps {
  confirmQuit: (args: {
    parent: AppWindow | null;
    summaries: readonly QuitActivitySummary[];
  }) => Promise<boolean>;
  finalCleanup: () => void;
  flushBeforeQuit: () => Promise<void>;
  getActivities: () => readonly ForegroundActivity[];
  getDialogParent: () => AppWindow | null;
  getTaskRuns?: () => TaskRunsSnapshot;
  logFailure: (error: unknown) => void;
  proceedToQuit: () => void;
  readConfirmationMode: () => Promise<AppQuitConfirmationMode>;
  reportFailure?: (error: unknown) => void;
  shouldBypassQuitConfirmationForTests?: () => boolean;
}

export interface AppQuitController {
  getPhase: () => QuitPhase;
  handleBeforeQuit: (event: PreventableQuitEvent) => void;
}

function canShowQuitConfirmation(
  parent: AppWindow | null
): parent is AppWindow {
  return parent !== null && !parent.isDestroyed();
}

export function createAppQuitController(
  deps: AppQuitControllerDeps
): AppQuitController {
  let phase: QuitPhase = "idle";

  async function runQuitFlow(): Promise<void> {
    try {
      const mode = await deps.readConfirmationMode();
      const summaries = summarizeDangerousQuitActivities(
        deps.getActivities(),
        deps.getTaskRuns?.()
      );
      const shouldConfirm =
        !deps.shouldBypassQuitConfirmationForTests?.() &&
        shouldConfirmBeforeQuit(mode, summaries.length);
      if (shouldConfirm) {
        const parent = deps.getDialogParent();
        if (canShowQuitConfirmation(parent)) {
          const confirmed = await deps.confirmQuit({
            parent,
            summaries,
          });
          if (!confirmed) {
            phase = "idle";
            return;
          }
        }
      }

      phase = "preparing";
      await deps.flushBeforeQuit();
      phase = "quitting";
      deps.proceedToQuit();
    } catch (error) {
      deps.logFailure(error);
      deps.reportFailure?.(error);
      phase = "idle";
    }
  }

  return {
    getPhase: () => phase,
    handleBeforeQuit: (event) => {
      if (phase === "quitting") {
        deps.finalCleanup();
        return;
      }

      event.preventDefault();

      if (phase === "confirming" || phase === "preparing") {
        const parent = deps.getDialogParent();
        if (parent && !parent.isDestroyed()) {
          parent.focus();
        }
        return;
      }

      phase = "confirming";
      runQuitFlow().catch((error) => {
        deps.logFailure(error);
        phase = "idle";
      });
    },
  };
}
