import type { PierEvent } from "@shared/contracts/events.ts";

export type PierEventListener = (event: PierEvent) => void;

export interface PierEventBus {
  publish(event: PierEvent): void;
  subscribe(listener: PierEventListener): () => void;
}

export function createPierEventBus(): PierEventBus {
  const listeners = new Set<PierEventListener>();
  return {
    publish(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
