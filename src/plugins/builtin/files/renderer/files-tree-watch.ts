import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { getFilesTreeSnapshot } from "./files-tree-store.ts";
import type { FilesTreeList } from "./files-tree-visibility.ts";
import { applyFilesTreeWatchEvent } from "./files-tree-watch-events.ts";
import type { FilesWatchHub } from "./files-watch-hub.ts";

const activeWatchers = new Map<string, () => void>();
const TRAILING_SLASHES_PATTERN = /\/+$/;

function normalizeRoot(root: string): string {
  return root.replace(TRAILING_SLASHES_PATTERN, "");
}

export function ensureFilesTreeWatch(
  context: RendererPluginContext,
  watchHub: FilesWatchHub,
  root: string,
  list: FilesTreeList
): void {
  const key = normalizeRoot(root);
  if (activeWatchers.has(key)) {
    return;
  }

  const t = (messageKey: string, fallback: string) =>
    context.i18n.t(messageKey, undefined, fallback);
  const unsubscribe = watchHub.subscribe(root, (event) => {
    const snapshot = getFilesTreeSnapshot(root);
    if (!(snapshot.rootLoaded || snapshot.rootLoading)) {
      return;
    }
    applyFilesTreeWatchEvent(
      root,
      event,
      list,
      t("panel.loadError.fallback", "Failed to load files")
    );
  });
  activeWatchers.set(key, unsubscribe);
}

export function clearFilesTreeWatchers(): void {
  for (const unsubscribe of activeWatchers.values()) {
    unsubscribe();
  }
  activeWatchers.clear();
}
