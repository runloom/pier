import type { FileWatchEvent } from "@shared/contracts/file/watch.ts";
import { FILES_AUTO_SAVE_DELAY_MS } from "../../settings.ts";
import type { FileDocumentLoader } from "./loader.ts";
import type { FileDocumentPanelRegistry } from "./panel-registry.ts";
import { isSamePathOrDescendant } from "./paths.ts";
import { getDocument, listOpenDiskDocuments } from "./store.ts";
import type { FilesDocument } from "./types.ts";

export function scheduleDocumentAutoSave(input: {
  autoSaveEnabled: boolean;
  document: FilesDocument;
  panelId: string | null | undefined;
  saveDocument: (documentId: string, panelId?: string) => Promise<unknown>;
  saveTimers: Map<string, ReturnType<typeof setTimeout>>;
  suspending: boolean;
}): void {
  const { document } = input;
  clearDocumentAutoSaveTimer(input.saveTimers, document.id);
  if (
    input.suspending ||
    !(input.autoSaveEnabled && document.dirty) ||
    document.source.kind !== "disk" ||
    document.saveState === "saving"
  ) {
    return;
  }
  const timer = setTimeout(() => {
    input.saveTimers.delete(document.id);
    input
      .saveDocument(document.id, input.panelId ?? undefined)
      .catch(() => undefined);
  }, FILES_AUTO_SAVE_DELAY_MS);
  input.saveTimers.set(document.id, timer);
}

export function clearDocumentAutoSaveTimer(
  saveTimers: Map<string, ReturnType<typeof setTimeout>>,
  documentId: string
): void {
  const timer = saveTimers.get(documentId);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(documentId);
  }
}

export function clearAllDocumentAutoSaveTimers(
  saveTimers: Map<string, ReturnType<typeof setTimeout>>
): void {
  for (const timer of saveTimers.values()) {
    clearTimeout(timer);
  }
  saveTimers.clear();
}

/** Reload open disk documents affected by a file-watch event. */
export function reloadDocumentsForFileWatchEvent(input: {
  acquiredDocumentIds: ReadonlySet<string>;
  event: FileWatchEvent;
  loader: Pick<FileDocumentLoader, "start">;
}): void {
  const paths = input.event.changes.map((change) => change.path);
  for (const document of listOpenDiskDocuments()) {
    if (
      document.source.kind !== "disk" ||
      !input.acquiredDocumentIds.has(document.id)
    ) {
      continue;
    }
    const locatorPath = document.source.path;
    const affected = paths.some(
      (path) =>
        path === "." ||
        isSamePathOrDescendant(locatorPath, path) ||
        (document.canonicalPath !== null &&
          isSamePathOrDescendant(document.canonicalPath, path))
    );
    if (!affected) {
      continue;
    }
    input.loader.start(document.id, true);
  }
}

/**
 * dirty→clean with a retained disk snapshot (edit→undo after external write):
 * schedule one reload so clean buffers adopt disk without waiting for another
 * fs event. Level-triggering is avoided by the caller passing wasDirty.
 */
export function maybeAdoptDiskAfterDirtyCleared(input: {
  documentId: string;
  loader: Pick<FileDocumentLoader, "start">;
  suspending: boolean;
  wasDirty: boolean;
}): void {
  if (input.suspending || !input.wasDirty) {
    return;
  }
  const document = getDocument(input.documentId);
  if (
    document?.source.kind === "disk" &&
    document.diskConflict &&
    !document.dirty
  ) {
    input.loader.start(document.id, true);
  }
}

export function handleDocumentStoreChangeForLiveSync(input: {
  autoSaveEnabled: boolean;
  lastContents: Map<string, string>;
  lastDirty: Map<string, boolean>;
  loader: Pick<FileDocumentLoader, "start">;
  panelDocumentIds: ReadonlySet<string>;
  panelIdForDocument: (documentId: string) => string | null;
  saveDocument: (documentId: string, panelId?: string) => Promise<unknown>;
  saveTimers: Map<string, ReturnType<typeof setTimeout>>;
  suspending: boolean;
}): void {
  for (const documentId of input.panelDocumentIds) {
    const document = getDocument(documentId);
    if (!document) {
      continue;
    }
    const previousContents = input.lastContents.get(document.id);
    const wasDirty = input.lastDirty.get(document.id) === true;
    input.lastContents.set(document.id, document.currentContents);
    input.lastDirty.set(document.id, document.dirty);
    if (!document.dirty) {
      clearDocumentAutoSaveTimer(input.saveTimers, document.id);
      maybeAdoptDiskAfterDirtyCleared({
        documentId: document.id,
        loader: input.loader,
        suspending: input.suspending,
        wasDirty,
      });
    } else if (previousContents !== document.currentContents) {
      scheduleDocumentAutoSave({
        autoSaveEnabled: input.autoSaveEnabled,
        document,
        panelId: input.panelIdForDocument(document.id),
        saveDocument: input.saveDocument,
        saveTimers: input.saveTimers,
        suspending: input.suspending,
      });
    }
  }
}

export function scheduleAllDirtyDocumentsForLiveSync(input: {
  autoSaveEnabled: boolean;
  panelDocumentIds: ReadonlySet<string>;
  panelIdForDocument: (documentId: string) => string | null;
  saveDocument: (documentId: string, panelId?: string) => Promise<unknown>;
  saveTimers: Map<string, ReturnType<typeof setTimeout>>;
  suspending: boolean;
}): void {
  for (const documentId of input.panelDocumentIds) {
    const document = getDocument(documentId);
    if (document?.dirty) {
      scheduleDocumentAutoSave({
        autoSaveEnabled: input.autoSaveEnabled,
        document,
        panelId: input.panelIdForDocument(document.id),
        saveDocument: input.saveDocument,
        saveTimers: input.saveTimers,
        suspending: input.suspending,
      });
    }
  }
}

export function handleFileWatchForLiveSync(input: {
  event: FileWatchEvent;
  loader: Pick<FileDocumentLoader, "start">;
  markReloadAfterSuspend: () => void;
  panels: Pick<FileDocumentPanelRegistry, "documentIdsForRoot">;
  suspending: boolean;
}): void {
  if (input.suspending) {
    input.markReloadAfterSuspend();
    return;
  }
  reloadDocumentsForFileWatchEvent({
    acquiredDocumentIds: input.panels.documentIdsForRoot(input.event.root),
    event: input.event,
    loader: input.loader,
  });
}
