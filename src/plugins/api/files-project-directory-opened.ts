/**
 * Host ↔ files plugin bus for "project directory tab opened / focused".
 * Host notifies after `openProjectDirectory`; files tree subscribes for reveal.
 * Sibling of `files-disk-path-opened.ts` — never reuse that event for tree-only tabs.
 */

export interface FilesProjectDirectoryOpenedEvent {
  /** Files panel instance id (`pier.files.filePanel:project:<hash>`). */
  instanceId: string;
  /** Repo-relative path. Empty string = project root. */
  path: string;
  root: string;
}

export type FilesProjectDirectoryOpenedListener = (
  event: FilesProjectDirectoryOpenedEvent
) => void;

const listeners = new Set<FilesProjectDirectoryOpenedListener>();

export function onFilesProjectDirectoryOpened(
  listener: FilesProjectDirectoryOpenedListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyFilesProjectDirectoryOpened(
  event: FilesProjectDirectoryOpenedEvent
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
export function resetFilesProjectDirectoryOpenedForTests(): void {
  listeners.clear();
}
