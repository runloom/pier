import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import type {
  TaskExitReason,
  TaskExitSource,
} from "@shared/contracts/tasks.ts";
import type { CreateTerminalArgs } from "@shared/contracts/terminal.ts";
import { updateTerminalPanelTab } from "../state/terminal-session-state.ts";

export async function persistInitialTerminalTab(
  sessionScope: string,
  panelId: string,
  tab: CreateTerminalArgs["tab"]
): Promise<void> {
  if (!tab) {
    return;
  }
  try {
    await updateTerminalPanelTab(sessionScope, panelId, tab);
  } catch (err) {
    console.error("[pier-tab-initial-persist] failed:", err);
  }
}

export interface TerminalTaskExitStatus {
  code?: number | undefined;
  reason: TaskExitReason;
  source: TaskExitSource;
}

export function taskExitTabPatch(
  exit: TerminalTaskExitStatus
): Partial<PanelTabChrome> {
  if (exit.reason === "user") {
    return {
      state: {
        colorToken: "warning",
        label: "Cancelled",
        status: "cancelled",
      },
    };
  }

  if (exit.code === 0) {
    return {
      state: {
        colorToken: "success",
        label: "Succeeded",
        status: "succeeded",
      },
    };
  }

  if (typeof exit.code === "number") {
    return {
      state: {
        colorToken: "destructive",
        label: `Failed ${exit.code}`,
        status: "failed",
      },
    };
  }

  return {
    state: {
      colorToken: "destructive",
      label: "Failed",
      status: "failed",
    },
  };
}
