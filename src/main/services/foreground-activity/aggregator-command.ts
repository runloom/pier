import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  clearForegroundAgentCommandFinished,
  markForegroundAgentCommandFinished,
} from "./agent-session-ended.ts";
import { keysForPanel, panelKey } from "./aggregator-panel-key.ts";
import {
  logClearForeignHook,
  logCommandFinished,
} from "./aggregator-tracing.ts";
import { armLaunchVisibility } from "./aggregator-visibility.ts";
import {
  CLOSE_COOLDOWN_MS,
  clearCommandTimers,
  clearHookTimers,
  newAgentLaunchLayer,
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
export function applyAgentLaunched(input: {
  agentId: AgentKind;
  now: () => number;
  panelCooldownUntil: Map<string, number>;
  hookCooldownUntil: Map<string, number>;
  panelId: string;
  scheduleEmit: () => void;
  slotFor: (key: string, panelId: string) => PanelSlot;
  slots: Map<string, PanelSlot>;
  windowId: string;
}): void {
  clearForegroundAgentCommandFinished(input.panelId, input.windowId);
  const key = panelKey(input.windowId, input.panelId);
  input.panelCooldownUntil.delete(key);
  input.hookCooldownUntil.delete(key);
  const slot = input.slotFor(key, input.panelId);
  const existing = slot.command;
  if (existing?.kind === "agent-launch" && existing.agentId === input.agentId) {
    existing.updatedAt = input.now();
    existing.windowId = input.windowId;
  } else {
    if (existing) {
      clearCommandTimers(existing);
    }
    const layer = newAgentLaunchLayer(
      input.windowId,
      input.agentId,
      input.now()
    );
    slot.command = layer;
    armLaunchVisibility(key, layer, {
      scheduleEmit: input.scheduleEmit,
      slots: input.slots,
    });
  }
  const hook = slot.hook;
  if (hook && hook.agentId !== input.agentId) {
    logClearForeignHook(key, hook.agentId, input.agentId);
    clearHookTimers(hook);
    slot.hook = null;
  }
  input.scheduleEmit();
}

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
  markForegroundAgentCommandFinished(input.panelId, input.windowId);
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
