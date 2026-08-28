/** Panel-params reveal bus for canvas anchor scroll. */
import { useSyncExternalStore } from "react";

const revealByPath = new Map<string, string>();
const revealListeners = new Set<() => void>();

export function requestCanvasAnchorReveal(
  path: string,
  anchorId: string
): void {
  revealByPath.set(path, anchorId);
  for (const listener of revealListeners) {
    listener();
  }
}

export function useCanvasRevealAnchor(path: string): string | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      revealListeners.add(onStoreChange);
      return () => {
        revealListeners.delete(onStoreChange);
      };
    },
    () => revealByPath.get(path) ?? null,
    () => null
  );
}
