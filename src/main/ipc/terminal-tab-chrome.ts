import type { PanelTabChrome } from "@shared/contracts/panel.ts";
import type {
  TaskExitReason,
  TaskExitSource,
} from "@shared/contracts/tasks.ts";
import type { CreateTerminalArgs } from "@shared/contracts/terminal.ts";
import {
  buildTaskEndTabState,
  taskEndTabStatusFromExit,
} from "@shared/contracts/terminal-end-state.ts";
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

/** Task 退出 tab：shared 终态语义（成功仍可绿勾）。 */
export function taskExitTabPatch(
  exit: TerminalTaskExitStatus
): Partial<PanelTabChrome> {
  const { status, exitCode } = taskEndTabStatusFromExit({
    code: exit.code,
    reason: exit.reason,
  });
  return { state: buildTaskEndTabState(status, exitCode) };
}
