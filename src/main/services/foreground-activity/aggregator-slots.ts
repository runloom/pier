import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  ForegroundActivity,
  ForegroundActivityBroadcast,
} from "@shared/contracts/foreground-activity.ts";
import type { PanelSlot } from "./entry.ts";
import { projectSlot } from "./slot-projection.ts";

/** OSC 点亮的前台命令层归属 agent；非 agent-launch 命令层 → null。 */
export function commandOwnedAgent(
  slot: PanelSlot | undefined
): AgentKind | null {
  return slot?.command?.kind === "agent-launch" ? slot.command.agentId : null;
}

/** 清理已到期的冷却记录（面板关闭 / hook 迟到拦截等冷却窗口共用）。 */
export function pruneExpiredCooldownEntries(
  maps: Iterable<Map<string, number>>,
  now: () => number
): void {
  for (const map of maps) {
    for (const [id, until] of map) {
      if (now() >= until) {
        map.delete(id);
      }
    }
  }
}

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
