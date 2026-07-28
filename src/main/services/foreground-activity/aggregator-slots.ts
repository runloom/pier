import type {
  ForegroundActivity,
  ForegroundActivityBroadcast,
} from "@shared/contracts/foreground-activity.ts";
import type { PanelSlot } from "./entry.ts";
import { projectSlot } from "./entry.ts";

export function buildForegroundActivityBroadcast(
  slots: ReadonlyMap<string, PanelSlot>,
  ts: number
): ForegroundActivityBroadcast {
  const activities: ForegroundActivity[] = [];
  for (const slot of slots.values()) {
    const activity = projectSlot(slot.panelId, slot);
    if (activity) {
      activities.push(activity);
    }
  }
  return { activities, ts };
}

export function createPanelSlotRegistry(slots: Map<string, PanelSlot>): {
  dropSlotIfEmpty: (key: string) => void;
  slotFor: (key: string, panelId: string) => PanelSlot;
} {
  return {
    dropSlotIfEmpty(key) {
      const slot = slots.get(key);
      if (slot && !slot.command && !slot.hook) {
        slots.delete(key);
      }
    },
    slotFor(key, panelId) {
      let slot = slots.get(key);
      if (!slot) {
        slot = { command: null, hook: null, panelId };
        slots.set(key, slot);
      }
      return slot;
    },
  };
}
