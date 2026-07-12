import {
  type AgentLaunchLayer,
  type HookLayer,
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

export function revealHook(hook: HookLayer): void {
  if (!hook.hidden) return;
  hook.hidden = false;
  if (hook.visibilityTimer) {
    clearTimeout(hook.visibilityTimer);
    hook.visibilityTimer = null;
  }
}
