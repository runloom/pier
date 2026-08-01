import type {
  FilesDocument,
  FilesDocumentPanelSource,
} from "../document/types.ts";
import type { FilesPanelTransferViewSeed } from "./transfer-state.ts";

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
