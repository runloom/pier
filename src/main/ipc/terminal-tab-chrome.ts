import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import type {
  TaskExitReason,
  TaskExitSource,
} from "@shared/contracts/tasks.ts";
import { taskRunTabState } from "@shared/contracts/tasks.ts";
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
    return { state: taskRunTabState("cancelled") };
  }
  if (exit.code === 0) {
    return { state: taskRunTabState("succeeded", 0) };
  }
  return { state: taskRunTabState("failed", exit.code) };
}
