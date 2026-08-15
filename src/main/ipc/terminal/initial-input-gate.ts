/**
 * Setup / taskPrompt 写入门控：等交互 prompt 再打 stdin。
 * OSC 7 是 precmd；有 viewport 时再等到最后一行不是 login banner。
 * 无 shell integration 走后备定时器。
 */

export const PROMPT_PAINT_POLL_MS = 32;
const DEFAULT_FALLBACK_MS = 1500;

export interface SchedulePromptReadyOptions {
  isPainted?: () => boolean;
  pollMs?: number;
}

interface PendingEntry {
  fire: () => void;
  options: SchedulePromptReadyOptions;
  polling: boolean;
  timer: NodeJS.Timeout;
}

const pendingByPanelId = new Map<string, PendingEntry>();

export function viewportHasPaintedPrompt(
  text: string | null | undefined
): boolean {
  if (typeof text !== "string" || text.length === 0) {
    return false;
  }
  const lines = text.split(/\r?\n/u).map((line) => line.replace(/\s+$/u, ""));
  let last: string | undefined;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line && line.length > 0) {
      last = line;
      break;
    }
  }
  if (!last) {
    return false;
  }
  return !/^Last login:/iu.test(last);
}

function consume(panelId: string): PendingEntry | null {
  const entry = pendingByPanelId.get(panelId);
  if (!entry) {
    return null;
  }
  pendingByPanelId.delete(panelId);
  clearTimeout(entry.timer);
  return entry;
}

export function schedulePromptReady(
  panelId: string,
  fire: () => void,
  fallbackMs = DEFAULT_FALLBACK_MS,
  options: SchedulePromptReadyOptions = {}
): void {
  consume(panelId);
  const timer = setTimeout(() => {
    pendingByPanelId.delete(panelId);
    fire();
  }, fallbackMs);
  pendingByPanelId.set(panelId, {
    fire,
    options,
    polling: false,
    timer,
  });
}

export function signalPromptReady(panelId: string): void {
  const entry = pendingByPanelId.get(panelId);
  if (!entry || entry.polling) {
    return;
  }
  const painted = entry.options.isPainted;
  if (!painted || painted()) {
    consume(panelId)?.fire();
    return;
  }
  entry.polling = true;
  clearTimeout(entry.timer);
  const startedAt = Date.now();
  const pollMs = entry.options.pollMs ?? PROMPT_PAINT_POLL_MS;
  const tick = (): void => {
    const current = pendingByPanelId.get(panelId);
    if (current !== entry) {
      return;
    }
    if (painted() || Date.now() - startedAt >= DEFAULT_FALLBACK_MS) {
      consume(panelId);
      entry.fire();
      return;
    }
    entry.timer = setTimeout(tick, pollMs);
  };
  entry.timer = setTimeout(tick, pollMs);
}

export function cancelPromptReady(panelId: string): void {
  consume(panelId);
}
