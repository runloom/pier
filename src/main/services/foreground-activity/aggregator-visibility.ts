import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import type { AgentTurnEventSemantics } from "./agent-turn-event-semantics.ts";
import {
  type AgentLaunchLayer,
  type HookLayer,
  newHookLayer,
  type PanelSlot,
  VISIBILITY_DEBOUNCE_MS,
} from "./entry.ts";

interface VisibilityContext {
  scheduleEmit: () => void;
  slots: Map<string, PanelSlot>;
}

export function armLaunchVisibility(
  key: string,
  layer: AgentLaunchLayer,
  context: VisibilityContext
): void {
  layer.visibilityTimer = setTimeout(() => {
    const current = context.slots.get(key)?.command;
    if (current?.kind !== "agent-launch" || current !== layer) return;
    current.visibilityTimer = null;
    if (current.hidden) {
      current.hidden = false;
      context.scheduleEmit();
    }
  }, VISIBILITY_DEBOUNCE_MS);
}

export function armHookVisibility(
  key: string,
  layer: HookLayer,
  context: VisibilityContext
): void {
  layer.visibilityTimer = setTimeout(() => {
    const current = context.slots.get(key)?.hook;
    if (current !== layer) return;
    current.visibilityTimer = null;
    if (current.hidden) {
      current.hidden = false;
      context.scheduleEmit();
    }
  }, VISIBILITY_DEBOUNCE_MS);
}

export function acquireHookLayer(
  key: string,
  event: AgentHookEventPayload,
  semantics: AgentTurnEventSemantics,
  at: number,
  slotFor: (key: string, panelId: string) => PanelSlot,
  dropSlotIfEmpty: (key: string) => void,
  context: VisibilityContext
): HookLayer | null {
  const slot = slotFor(key, event.panelId);
  const existing = slot.hook;
  if (existing) {
    return existing;
  }
  if (!semantics.createsSession) {
    dropSlotIfEmpty(key);
    return null;
  }
  const hook = newHookLayer(event, at, semantics.category === "session-start");
  slot.hook = hook;
  if (hook.hidden) {
    armHookVisibility(key, hook, context);
  }
  return hook;
}

export function revealHook(hook: HookLayer): void {
  if (!hook.hidden) return;
  hook.hidden = false;
  if (hook.visibilityTimer) {
    clearTimeout(hook.visibilityTimer);
    hook.visibilityTimer = null;
  }
}
