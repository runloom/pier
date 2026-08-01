/**
 * Host ↔ files plugin bus for "disk path opened in editor".
 * Host notifies after `openFilesDiskPath`; files tree subscribes for reveal.
 * Lives in plugins/api so builtin plugins never import `src/renderer`.
 */

export interface FilesDiskPathOpenedEvent {
  instanceId: string;
  path: string;
  root: string;
}

export type FilesDiskPathOpenedListener = (
  event: FilesDiskPathOpenedEvent
) => void;

const listeners = new Set<FilesDiskPathOpenedListener>();

export function onFilesDiskPathOpened(
  listener: FilesDiskPathOpenedListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyFilesDiskPathOpened(
  event: FilesDiskPathOpenedEvent
): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Listeners must not break open; failures are non-fatal.
    }
  }
}

/** @internal test helper */
export function resetFilesDiskPathOpenedForTests(): void {
  listeners.clear();
}
