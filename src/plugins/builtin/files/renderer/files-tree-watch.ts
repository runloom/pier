import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  getDocument,
  listOpenDiskDocuments,
  markDocumentDiskConflict,
  markDocumentLoaded,
} from "./files-document-store.ts";
import {
  applyFilesTreeWatchEvent,
  getFilesTreeSnapshot,
} from "./files-tree-store.ts";

const activeWatchers = new Map<string, () => void>();
const TRAILING_SLASHES_PATTERN = /\/+$/;

function normalizeRoot(root: string): string {
  return root.replace(TRAILING_SLASHES_PATTERN, "");
}

function applyOpenDocumentDiskChanges(
  files: RendererPluginContext["files"],
  root: string,
  paths: readonly string[]
): void {
  const normalizedRoot = normalizeRoot(root);
  for (const document of listOpenDiskDocuments()) {
    if (document.source.kind !== "disk") {
      continue;
    }
    if (normalizeRoot(document.source.root) !== normalizedRoot) {
      continue;
    }
    if (!(paths.includes(document.source.path) || paths.includes("."))) {
      continue;
    }
    if (document.dirty) {
      markDocumentDiskConflict(document.id);
      continue;
    }
    if (document.loadState !== "loaded") {
      continue;
    }
    const { path, root: documentRoot } = document.source;
    Promise.all([
      files.readText({ path, root: documentRoot }),
      files.stat({ path, root: documentRoot }),
    ])
      .then(([contents, stat]) => {
        const latest = getDocument(document.id);
        if (!latest || latest.dirty || latest.source.kind !== "disk") {
          return;
        }
        if (
          latest.source.path !== path ||
          latest.source.root !== documentRoot
        ) {
          return;
        }
        markDocumentLoaded(document.id, contents, stat.mtimeMs);
      })
      .catch(() => {
        // Ignore reload races; next explicit open/save surfaces the failure.
      });
  }
}

export function ensureFilesTreeWatch(
  context: RendererPluginContext,
  root: string
): void {
  const key = normalizeRoot(root);
  if (activeWatchers.has(key)) {
    return;
  }

  const t = (messageKey: string, fallback: string) =>
    context.i18n.t(messageKey, undefined, fallback);
  // watch 依赖 preload IPC facade;失败(测试环境/受限窗口)不应连累树加载,
  // 树退化为手动 Refresh 模式。
  let unsubscribe: () => void;
  try {
    unsubscribe = context.files.watch(root, (event) => {
      const snapshot = getFilesTreeSnapshot(root);
      if (!(snapshot.rootLoaded || snapshot.rootLoading)) {
        return;
      }
      applyFilesTreeWatchEvent(
        root,
        event,
        context.files.list,
        t("panel.loadError.fallback", "Failed to load files")
      );
      applyOpenDocumentDiskChanges(
        context.files,
        root,
        event.changes.map((change) => change.path)
      );
    });
  } catch (error) {
    console.error("[files] file watch unavailable:", error);
    unsubscribe = () => undefined;
  }
  activeWatchers.set(key, unsubscribe);
}

export function clearFilesTreeWatchers(): void {
  for (const unsubscribe of activeWatchers.values()) {
    unsubscribe();
  }
  activeWatchers.clear();
}
