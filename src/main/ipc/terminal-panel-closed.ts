import { TASK_EXIT_TITLE_PREFIX } from "@shared/contracts/tasks.ts";

type TerminalPanelClosedHandler = (panelId: string) => void;

let handler: TerminalPanelClosedHandler | null = null;

export function notifyTerminalPanelClosed(panelId: string): void {
  handler?.(panelId);
}

export function handleTaskExitTitle(
  panelId: string,
  title: string
): number | null {
  if (!title.startsWith(TASK_EXIT_TITLE_PREFIX)) {
    return null;
  }
  const code = Number.parseInt(title.slice(TASK_EXIT_TITLE_PREFIX.length), 10);
  if (!Number.isFinite(code)) {
    return null;
  }
  handler?.(panelId);
  return code;
}

export function setTerminalPanelClosedHandler(
  next: TerminalPanelClosedHandler | null
): void {
  handler = next;
}

export const terminalPanelClosed = {
  handleTaskExitTitle,
  notifyTerminalPanelClosed,
} as const;
