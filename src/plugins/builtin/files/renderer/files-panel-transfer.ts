/**
 * Cross-window panel transfer adapter for the Files file panel
 * (`pier.files.filePanel`).
 *
 * Draft body text never enters prepared state / journal. Recoverable drafts are
 * cloned to a transfer staging key (with `id` rewritten to the target document
 * identity), main copies staging→target, and the target renderer hydrates the
 * copied draft into the client store before ensuring the document.
 */

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
import {
  type FilesPanelTransferViewSeed,
  readFilesPanelViewMode,
} from "./files-panel-transfer-state.ts";
import { nextUntitledIdentity } from "./files-untitled-identity.ts";

export interface FilesPanelTransferViewCapture {
  scroll?: { left: number; top: number };
  selection?: { anchor: number; head: number };
}

export interface FilesPanelTransferDeps {
  allocateExplicitDiskDocumentId?: () => string;
  captureViewSnapshot?: (input: {
    documentId: string;
    panelId: string;
  }) => FilesPanelTransferViewCapture | null;
  discardDocument: (documentId: string) => void;
  ensureDiskDocument: (input: {
    documentId?: string;
    name?: string;
    path: string;
    root: string;
  }) => FilesDocument;
  flushFilesDraftWrites: () => Promise<void>;
  getDocument: (documentId: string) => FilesDocument | null;
  getDocumentForPanelSource: (
    source: FilesDocumentPanelSource
  ) => FilesDocument | null;
  /**
   * Recover the live acquired source for a panel when dockview params.source
   * is missing or fails schema parse (race / layout drift).
   */
  getPanelSource?: (panelId: string) => FilesDocumentPanelSource | null;
  hasDocumentId?: (documentId: string) => boolean;
  hasDocumentName?: (name: string) => boolean;
  hydrateDraftKey: (key: string) => Promise<string | null>;
  nextUntitledIdentity?: (input: {
    idExists: (id: string) => boolean;
    nameExists: (name: string) => boolean;
  }) => { id: string; name: string };
  persistFilesDraftRecord: (key: string, value: string) => void;
  readFilesPanelViewMode?: (
    panelId: string
  ) => FilesPanelTransferViewSeed["mode"];
  removeFilesDraftRecord: (key: string) => void;
  restoreUntitledDocumentFromPanelSource: (
    source: Extract<FilesDocumentPanelSource, { kind: "untitled" }>
  ) => FilesDocument | null;
  resumeTransferMutations: (scope: {
    documentId: string;
    panelId: string;
  }) => void;
  seedFilesPanelView?: (input: {
    documentId?: string;
    panelId: string;
    view: FilesPanelTransferViewSeed;
  }) => void;
  suspendTransferMutations: (
    scope: { documentId: string; panelId: string },
    signal: AbortSignal
  ) => Promise<void>;
}

function hasRawPanelSource(params: Readonly<Record<string, unknown>>): boolean {
  return (
    "source" in params && params.source !== null && params.source !== undefined
  );
}

/**
 * Safe diagnostic for transfer failures — structure only, never document body.
 * Paths are redacted by main's `sanitizePanelTransferMessage` before UI.
 */
export function describeFilesPanelSourceParams(
  params: Readonly<Record<string, unknown>>
): string {
  const keys = Object.keys(params).sort().join(",") || "(none)";
  if (!("source" in params)) {
    return `paramsKeys=${keys}; source=missing`;
  }
  const raw = params.source;
  if (raw === null || raw === undefined) {
    return `paramsKeys=${keys}; source=${raw === null ? "null" : "undefined"}`;
  }
  if (typeof raw !== "object") {
    return `paramsKeys=${keys}; sourceType=${typeof raw}`;
  }
  const record = raw as Record<string, unknown>;
  const kind =
    typeof record.kind === "string" ? record.kind : typeof record.kind;
  if (kind === "disk") {
    const pathOk =
      typeof record.path === "string" && record.path.length > 0
        ? "set"
        : `bad(${typeof record.path})`;
    const rootOk =
      typeof record.root === "string" && record.root.length > 0
        ? "set"
        : `bad(${typeof record.root})`;
    const documentId = typeof record.documentId === "string" ? "set" : "absent";
    const parsed = parseFilesDocumentPanelSource(params);
    return `paramsKeys=${keys}; kind=disk; path=${pathOk}; root=${rootOk}; documentId=${documentId}; schema=${parsed ? "ok" : "fail"}`;
  }
  if (kind === "untitled") {
    const idOk =
      typeof record.id === "string" && record.id.length > 0
        ? "set"
        : `bad(${typeof record.id})`;
    const nameOk =
      typeof record.name === "string" && record.name.length > 0
        ? "set"
        : `bad(${typeof record.name})`;
    const parsed = parseFilesDocumentPanelSource(params);
    return `paramsKeys=${keys}; kind=untitled; id=${idOk}; name=${nameOk}; schema=${parsed ? "ok" : "fail"}`;
  }
  return `paramsKeys=${keys}; kind=${String(kind)}; schema=fail`;
}

export type FilesPanelTransferSourceResolution =
  | { kind: "params"; source: FilesDocumentPanelSource }
  | { kind: "registry"; source: FilesDocumentPanelSource }
  | { kind: "empty" }
  | { kind: "invalid"; detail: string };

/**
 * Resolve the document source for a files panel transfer.
 *
 * Prefer dockview params; fall back to the live panel registry when params
 * are empty/corrupt so an acquired editor tab still moves. Panels that never
 * had a source (project shell / empty file tab) return empty without error.
 */
export function resolveFilesPanelTransferSource(input: {
  getPanelSource?: (panelId: string) => FilesDocumentPanelSource | null;
  panelId: string;
  params: Readonly<Record<string, unknown>>;
}): FilesPanelTransferSourceResolution {
  const fromParams = parseFilesDocumentPanelSource(input.params);
  if (fromParams) {
    return { kind: "params", source: fromParams };
  }
  const fromRegistry = input.getPanelSource?.(input.panelId) ?? null;
  if (fromRegistry) {
    return { kind: "registry", source: fromRegistry };
  }
  if (!hasRawPanelSource(input.params)) {
    return { kind: "empty" };
  }
  return {
    kind: "invalid",
    detail: describeFilesPanelSourceParams(input.params),
  };
}

export function logFilesPanelTransfer(
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, string | number | boolean | undefined>
): void {
  const suffix = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  const line = suffix
    ? `[files.panelTransfer] ${message} ${suffix}`
    : `[files.panelTransfer] ${message}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export interface TransferBookkeeping {
  createdTarget: boolean;
  originalDraftKey?: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  targetDraftKey?: string;
  targetSource: FilesDocumentPanelSource;
  transferScope: { documentId: string; panelId: string } | null;
  view: FilesPanelTransferViewSeed;
}

const bookkeepingByTransferId = new Map<string, TransferBookkeeping>();

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

export function rememberBookkeeping(
  transferId: string,
  entry: TransferBookkeeping
): void {
  bookkeepingByTransferId.set(transferId, entry);
}

export function takeBookkeeping(
  transferId: string
): TransferBookkeeping | undefined {
  const entry = bookkeepingByTransferId.get(transferId);
  bookkeepingByTransferId.delete(transferId);
  return entry;
}

export function getBookkeeping(
  transferId: string
): TransferBookkeeping | undefined {
  return bookkeepingByTransferId.get(transferId);
}

export function forgetBookkeeping(transferId: string): void {
  bookkeepingByTransferId.delete(transferId);
}

export function clearFilesPanelTransferBookkeepingForTests(): void {
  bookkeepingByTransferId.clear();
}
