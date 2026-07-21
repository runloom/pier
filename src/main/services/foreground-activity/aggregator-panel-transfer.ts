/** Rekey foreground-activity panel slots across Pier window ownership moves. */

import { panelKey } from "./aggregator-panel-key.ts";
import type { PanelSlot } from "./entry.ts";

export function transferPanelOwnership(
  ctx: {
    hookCooldownUntil: Map<string, number>;
    panelCooldownUntil: Map<string, number>;
    scheduleEmit: () => void;
    slots: Map<string, PanelSlot>;
  },
  input: {
    panelId: string;
    sourceWindowId: string;
    targetWindowId: string;
  }
): void {
  const { panelId, sourceWindowId, targetWindowId } = input;
  if (
    panelId.trim().length === 0 ||
    sourceWindowId.trim().length === 0 ||
    targetWindowId.trim().length === 0 ||
    sourceWindowId === targetWindowId
  ) {
    return;
  }
  const sourceKey = panelKey(sourceWindowId, panelId);
  const targetKey = panelKey(targetWindowId, panelId);
  const slot = ctx.slots.get(sourceKey);
  if (!slot) {
    // Still migrate cooldown maps so late source hooks do not revive source.
    for (const map of [ctx.panelCooldownUntil, ctx.hookCooldownUntil]) {
      if (map.has(sourceKey)) {
        map.set(targetKey, map.get(sourceKey)!);
        map.delete(sourceKey);
      }
    }
    return;
  }
  ctx.slots.delete(sourceKey);
  if (slot.command) {
    slot.command.windowId = targetWindowId;
  }
  if (slot.hook) {
    slot.hook.windowId = targetWindowId;
  }
  ctx.slots.set(targetKey, slot);
  for (const map of [ctx.panelCooldownUntil, ctx.hookCooldownUntil]) {
    if (map.has(sourceKey)) {
      map.set(targetKey, map.get(sourceKey)!);
      map.delete(sourceKey);
    }
  }
  ctx.scheduleEmit();
}
