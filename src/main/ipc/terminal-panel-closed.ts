import { TASK_EXIT_TITLE_PREFIX } from "@shared/contracts/tasks.ts";

type TerminalPanelClosedHandler = (
  panelId: string,
  exitCode?: number | undefined,
  windowId?: string | undefined
) => void;

let handler: TerminalPanelClosedHandler | null = null;

export function notifyTerminalPanelClosed(
  panelId: string,
  windowId?: string | undefined
): void {
  if (windowId) {
    handler?.(panelId, undefined, windowId);
    return;
  }
  handler?.(panelId);
}

export function notifyTerminalPanelExit(
  panelId: string,
  exitCode: number,
  windowId?: string | undefined
): void {
  if (windowId) {
    handler?.(panelId, exitCode, windowId);
    return;
  }
  handler?.(panelId, exitCode);
}

export function parseTaskExitTitle(title: string): number | null {
  if (!title.startsWith(TASK_EXIT_TITLE_PREFIX)) {
    return null;
  }
  const code = Number.parseInt(title.slice(TASK_EXIT_TITLE_PREFIX.length), 10);
  if (!Number.isFinite(code)) {
    return null;
  }
  return code < 0 ? 1 : code;
}

export function setTerminalPanelClosedHandler(
  next: TerminalPanelClosedHandler | null
): void {
  handler = next;
}

export const terminalPanelClosed = {
  parseTaskExitTitle,
  notifyTerminalPanelClosed,
  notifyTerminalPanelExit,
} as const;
