/** Rekey foreground-activity panel slots across Pier window ownership moves. */

import { panelKey } from "./aggregator-panel-key.ts";
import type { PanelSlot } from "./entry.ts";

export function transferPanelOwnership(
  ctx: {
    hookCooldownUntil: Map<string, number>;
    panelCooldownUntil: Map<string, number>;
    rekeySubagentSessions: (sourceKey: string, targetKey: string) => void;
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
  if (slot) {
    ctx.slots.delete(sourceKey);
    if (slot.command) {
      slot.command.windowId = targetWindowId;
    }
    if (slot.hook) {
      slot.hook.windowId = targetWindowId;
    }
    ctx.slots.set(targetKey, slot);
    ctx.scheduleEmit();
  }
  // Slot may be absent; still move cooldowns/registry so source hooks cannot revive.
  for (const map of [ctx.panelCooldownUntil, ctx.hookCooldownUntil]) {
    if (map.has(sourceKey)) {
      map.set(targetKey, map.get(sourceKey)!);
      map.delete(sourceKey);
    }
  }
  ctx.rekeySubagentSessions(sourceKey, targetKey);
}
