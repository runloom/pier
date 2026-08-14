import { keysForPanel } from "./aggregator-panel-key.ts";
import { logCommandFinished } from "./aggregator-tracing.ts";
import {
  CLOSE_COOLDOWN_MS,
  clearCommandTimers,
  newShellLayer,
  type PanelSlot,
  SUSPENDED_JOB_EXIT_CODES,
} from "./entry.ts";

/**
 * Unmatched OSC 133 C only covers a vacant / shell command layer.
 * An existing agent-launch is the launcher prior (wrapper argv, `sh -c`),
 * not a real shell takeover — `fg` after Ctrl+Z has no launch layer.
 */
export function applyUnmatchedCommandStarted(
  slot: PanelSlot,
  windowId: string,
  commandLine: string,
  at: number
): boolean {
  if (slot.command?.kind === "agent-launch") {
    return false;
  }
  if (slot.command) {
    clearCommandTimers(slot.command);
  }
  slot.command = newShellLayer(windowId, commandLine, at);
  return true;
}

/**
 * OSC 133 D: launch/shell-only slots close. A live hook owns the session, so
 * a wrapper or job-control D must not `closeSlot` (that 5s-cools PromptSubmit).
 */
export function finishPanelCommands(input: {
  closeSlot: (
    key: string,
    cooldown: { map: Map<string, number>; ms: number }
  ) => boolean;
  exitCode: number | undefined;
  hookCooldownUntil: Map<string, number>;
  panelId: string;
  slots: Map<string, PanelSlot>;
  windowId: string | undefined;
}): boolean {
  if (
    input.exitCode !== undefined &&
    SUSPENDED_JOB_EXIT_CODES.has(input.exitCode)
  ) {
    return false;
  }
  let changed = false;
  for (const key of keysForPanel(input.slots, input.panelId, input.windowId)) {
    const slot = input.slots.get(key);
    if (!slot) {
      continue;
    }
    logCommandFinished(key, input.exitCode);
    if (slot.hook) {
      if (slot.command) {
        clearCommandTimers(slot.command);
        slot.command = null;
        changed = true;
      }
      continue;
    }
    if (
      input.closeSlot(key, {
        map: input.hookCooldownUntil,
        ms: CLOSE_COOLDOWN_MS,
      })
    ) {
      changed = true;
    }
  }
  return changed;
}
