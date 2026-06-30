import type { CreateTerminalArgs } from "@shared/contracts/terminal.ts";
import {
  updateTerminalPanelContext,
  updateTerminalPanelTask,
} from "../state/terminal-session-state.ts";

export async function persistInitialTerminalContext(
  sessionScope: string,
  panelId: string,
  context: CreateTerminalArgs["context"]
): Promise<void> {
  if (!context) {
    return;
  }
  try {
    await updateTerminalPanelContext(sessionScope, panelId, context);
  } catch (err) {
    console.error("[pier-context-initial-persist] failed:", err);
  }
}

export async function persistInitialTerminalTask(
  sessionScope: string,
  panelId: string,
  task: CreateTerminalArgs["task"]
): Promise<void> {
  if (!task) {
    return;
  }
  try {
    await updateTerminalPanelTask(sessionScope, panelId, task);
  } catch (err) {
    console.error("[pier-task-initial-persist] failed:", err);
  }
}
