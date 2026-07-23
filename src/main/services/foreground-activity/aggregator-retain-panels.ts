/** Drop FA slots for panels no longer active in a window. */

import type { PanelSlot } from "./entry.ts";
import { CLOSE_COOLDOWN_MS } from "./entry.ts";

interface RetainCtx {
  closeSlot: (
    key: string,
    cooldown: { map: Map<string, number>; ms: number }
  ) => boolean;
  panelCooldownUntil: Map<string, number>;
  pruneExpiredCooldowns: () => void;
  scheduleEmit: () => void;
  slots: Map<string, PanelSlot>;
}

function closeMatchingSlots(
  ctx: RetainCtx,
  shouldClose: (slot: PanelSlot) => boolean
): void {
  let anyRemoved = false;
  for (const [key, slot] of [...ctx.slots.entries()]) {
    if (
      shouldClose(slot) &&
      ctx.closeSlot(key, {
        map: ctx.panelCooldownUntil,
        ms: CLOSE_COOLDOWN_MS,
      })
    ) {
      anyRemoved = true;
    }
  }
  if (anyRemoved) {
    ctx.scheduleEmit();
  }
  ctx.pruneExpiredCooldowns();
}

export function retainWindowPanels(
  ctx: RetainCtx,
  windowId: string,
  activePanelIds: readonly string[]
): void {
  const active = new Set(activePanelIds);
  closeMatchingSlots(ctx, (slot) => {
    const slotWindowId = slot.command?.windowId ?? slot.hook?.windowId;
    return slotWindowId === windowId && !active.has(slot.panelId);
  });
}

export function closeWindowPanels(ctx: RetainCtx, windowId: string): void {
  closeMatchingSlots(ctx, (slot) => {
    const slotWindowId = slot.command?.windowId ?? slot.hook?.windowId;
    return slotWindowId === windowId;
  });
}
