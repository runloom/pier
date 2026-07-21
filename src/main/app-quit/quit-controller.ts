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
    parent: AppWindow;
    summaries: readonly QuitActivitySummary[];
  }) => Promise<boolean>;
  /** Clear intentional relaunch arm when quit aborts/fails. */
  disarmIntentionalRelaunch?: () => void;
  finalCleanup: () => void;
  flushBeforeQuit: () => Promise<void>;
  getActivities: () => readonly ForegroundActivity[];
  getDialogParent: () => AppWindow | null;
  getTaskRuns?: () => TaskRunsSnapshot;
  /** Armed by app.relaunch / appUpdate.quitAndInstall — skip activity confirmation. */
  isIntentionalRelaunch?: () => boolean;
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
      const intentional = deps.isIntentionalRelaunch?.() === true;
      const mode = await deps.readConfirmationMode();
      const summaries = summarizeDangerousQuitActivities(
        deps.getActivities(),
        deps.getTaskRuns?.()
      );
      const shouldConfirm =
        !(intentional || deps.shouldBypassQuitConfirmationForTests?.()) &&
        shouldConfirmBeforeQuit(mode, summaries.length);
      if (shouldConfirm) {
        const parent = deps.getDialogParent();
        if (canShowQuitConfirmation(parent)) {
          const confirmed = await deps.confirmQuit({
            parent,
            summaries,
          });
          if (!confirmed) {
            deps.disarmIntentionalRelaunch?.();
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
      deps.disarmIntentionalRelaunch?.();
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
        deps.disarmIntentionalRelaunch?.();
        deps.logFailure(error);
        phase = "idle";
      });
    },
  };
}
