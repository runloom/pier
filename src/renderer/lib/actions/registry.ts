/**
 * Action registry singleton: register() 返回 disposer.
 *
 * subscribe / getVersion / notify 来自 Notifier 基类.
 */
import { Notifier } from "@/lib/util/notifier.ts";
import type { Action } from "./types.ts";

class ActionRegistry extends Notifier {
  private readonly actions = new Map<string, Action>();

  register(action: Action): () => void {
    if (this.actions.has(action.id)) {
      throw new Error(`action id is already registered: ${action.id}`);
    }
    this.actions.set(action.id, action);
    this.notify();
    return () => {
      if (this.actions.get(action.id) === action) {
        this.actions.delete(action.id);
        this.notify();
      }
    };
  }

  get(id: string): Action | undefined {
    return this.actions.get(id);
  }

  clearForTests(): void {
    if (this.actions.size === 0) return;
    this.actions.clear();
    this.notify();
  }

  list(surface?: string): readonly Action[] {
    const all = Array.from(this.actions.values());
    if (!surface) {
      return all;
    }
    return all
      .filter((a) => a.surfaces?.includes(surface))
      .sort(
        (a, b) => (a.metadata?.sortOrder ?? 0) - (b.metadata?.sortOrder ?? 0)
      );
  }
}

export const actionRegistry = new ActionRegistry();
export const subscribeActionRegistry = (listener: () => void): (() => void) =>
  actionRegistry.subscribe(listener);
export const getActionRegistryVersion = (): number =>
  actionRegistry.getVersion();
