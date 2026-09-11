import type { FileDocumentLoader } from "./loader.ts";
import {
  ensureDiskDocument,
  getDocument,
  restoreUntitledDocumentFromPanelSource,
} from "./store.ts";
import {
  type FilesDocument,
  type FilesDocumentPanelSource,
  resolveDiskDocumentId,
} from "./types.ts";

export function createRestoreSuppression(): {
  allow(documentId: string): void;
  clear(): void;
  isSuppressed(documentId: string): boolean;
  suppress(documentId: string): void;
} {
  const ids = new Set<string>();
  return {
    allow(documentId: string): void {
      ids.delete(documentId);
    },
    clear(): void {
      ids.clear();
    },
    isSuppressed(documentId: string): boolean {
      return ids.has(documentId);
    },
    suppress(documentId: string): void {
      ids.add(documentId);
    },
  };
}

export function documentIdForPanelSource(
  source: FilesDocumentPanelSource
): string {
  return source.kind === "untitled" ? source.id : resolveDiskDocumentId(source);
}

/**
 * Recreate an in-memory document for a still-open tab.
 * Always `start(false)`: idle shells reach `loaded` via `markDocumentReadResult`,
 * which keeps dirty buffers (`protectsLocalBufferFromDisk`). `start(true)` on an
 * idle draft can skip that write when revisions match and leave the tab read-only.
 */
export function ensureFilesDocument(input: {
  bindLiveSync: (document: FilesDocument) => void;
  claimLegacySource: (source: FilesDocumentPanelSource) => void;
  loader: Pick<FileDocumentLoader, "start">;
  source: FilesDocumentPanelSource;
  suppressed: boolean;
}): FilesDocument | null {
  const documentId = documentIdForPanelSource(input.source);
  if (input.suppressed) {
    return getDocument(documentId);
  }
  if (input.source.kind === "untitled") {
    const document =
      getDocument(input.source.id) ??
      restoreUntitledDocumentFromPanelSource(input.source);
    if (document) {
      input.bindLiveSync(document);
    } else {
      input.claimLegacySource(input.source);
    }
    return document;
  }
  const document = ensureDiskDocument({
    ...(input.source.documentId ? { documentId: input.source.documentId } : {}),
    path: input.source.path,
    root: input.source.root,
  });
  input.loader.start(document.id, false);
  input.claimLegacySource(input.source);
  input.bindLiveSync(document);
  return document;
}
