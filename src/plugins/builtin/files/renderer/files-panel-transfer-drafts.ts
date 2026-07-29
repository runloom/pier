import {
  diskDraftHasRecoverableState,
  diskDraftStorageKey,
  serializeDiskDraft,
  serializeUntitledDocument,
  untitledDraftStorageKey,
} from "./files-document-draft-records.ts";
import { allocateExplicitDiskDocumentId } from "./files-document-paths.ts";
import {
  type FilesDocument,
  type FilesDocumentPanelSource,
  parseFilesDocumentPanelSource,
  resolveDiskDocumentId,
  sameFilesDocumentPanelSource,
} from "./files-document-types.ts";
import type { FilesPanelTransferDeps } from "./files-panel-transfer-deps.ts";
import {
  type FilesPanelTransferViewSeed,
  readFilesPanelViewMode,
} from "./files-panel-transfer-state.ts";
import { nextUntitledIdentity } from "./files-untitled-identity.ts";

export function rewritePersistedDraftId(
  raw: string,
  targetDocumentId: string
): string {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Files panel transfer: invalid draft payload");
  }
  return JSON.stringify({
    ...(parsed as Record<string, unknown>),
    id: targetDocumentId,
  });
}

export function allocateTargetSource(
  document: FilesDocument,
  deps: FilesPanelTransferDeps
): {
  targetDocumentId: string;
  targetSource: FilesDocumentPanelSource;
} {
  if (document.source.kind === "untitled") {
    const next =
      deps.nextUntitledIdentity?.({
        idExists: (id) =>
          deps.hasDocumentId?.(id) === true || deps.getDocument(id) !== null,
        nameExists: (name) => deps.hasDocumentName?.(name) === true,
      }) ??
      nextUntitledIdentity({
        idExists: (id) =>
          deps.hasDocumentId?.(id) === true || deps.getDocument(id) !== null,
        nameExists: (name) => deps.hasDocumentName?.(name) === true,
      });
    return {
      targetDocumentId: next.id,
      targetSource: {
        id: next.id,
        kind: "untitled",
        name: next.name,
      },
    };
  }
  const allocate =
    deps.allocateExplicitDiskDocumentId ?? allocateExplicitDiskDocumentId;
  const targetDocumentId = allocate();
  return {
    targetDocumentId,
    targetSource: {
      documentId: targetDocumentId,
      kind: "disk",
      path: document.source.path,
      root: document.source.root,
    },
  };
}

export function captureViewSeed(
  deps: FilesPanelTransferDeps,
  panelId: string,
  documentId: string
): FilesPanelTransferViewSeed {
  const mode =
    deps.readFilesPanelViewMode?.(panelId) ?? readFilesPanelViewMode(panelId);
  const snapshot = deps.captureViewSnapshot?.({ documentId, panelId }) ?? null;
  return {
    mode,
    ...(snapshot?.selection ? { selection: snapshot.selection } : {}),
    ...(snapshot?.scroll ? { scroll: snapshot.scroll } : {}),
  };
}

export function needsDraftMigration(document: FilesDocument): boolean {
  return (
    document.source.kind === "untitled" ||
    diskDraftHasRecoverableState(document)
  );
}

export function originalDraftKeyFor(document: FilesDocument): string {
  return document.source.kind === "untitled"
    ? untitledDraftStorageKey(document.id)
    : diskDraftStorageKey(document.id);
}

export function targetDraftKeyFor(source: FilesDocumentPanelSource): string {
  if (source.kind === "untitled") {
    return untitledDraftStorageKey(source.id);
  }
  return diskDraftStorageKey(resolveDiskDocumentId(source));
}

export function serializeForStaging(document: FilesDocument): string {
  if (document.source.kind === "untitled") {
    const raw = serializeUntitledDocument(document);
    if (!raw) {
      throw new Error("Files panel transfer: untitled draft missing content");
    }
    return raw;
  }
  const raw = serializeDiskDraft(document);
  if (!raw) {
    throw new Error("Files panel transfer: disk draft not recoverable");
  }
  return raw;
}

export function remainingReferencesSource(
  remainingParams: readonly Readonly<Record<string, unknown>>[],
  sourceDocumentId: string,
  sourcePanelSource: FilesDocumentPanelSource | null
): boolean {
  for (const params of remainingParams) {
    const source = parseFilesDocumentPanelSource(params);
    if (!source) {
      continue;
    }
    if (
      sourcePanelSource &&
      sameFilesDocumentPanelSource(source, sourcePanelSource)
    ) {
      return true;
    }
    if (source.kind === "untitled" && source.id === sourceDocumentId) {
      return true;
    }
    if (
      source.kind === "disk" &&
      resolveDiskDocumentId(source) === sourceDocumentId
    ) {
      return true;
    }
  }
  return false;
}
