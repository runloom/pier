import { useLayoutEffect, useRef, useState } from "react";
import type { FilesDocument, FilesDocumentPanelSource } from "./types.ts";
import { useFilesDocument } from "./use-document.ts";

interface FilesPanelDocumentHost {
  acquirePanel: (
    panelId: string,
    source: FilesDocumentPanelSource
  ) => () => void;
  documentId: (source: FilesDocumentPanelSource) => string;
  ensureDocument: (
    source: FilesDocumentPanelSource,
    editorSessionId?: string
  ) => unknown;
}

/**
 * Recreate a dropped in-memory document for a still-open tab.
 * `source` is read from a ref: FilesGroupView reparses params every render.
 */
export function useEnsureRestoredDocument(input: {
  controller: FilesPanelDocumentHost;
  editorSessionId?: string;
  source: FilesDocumentPanelSource;
}): {
  document: FilesDocument | null;
  restoreAttempted: boolean;
} {
  const { controller, editorSessionId, source } = input;
  const documentId = controller.documentId(source);
  const document = useFilesDocument(documentId);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [attemptedId, setAttemptedId] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!document) {
      controller.ensureDocument(sourceRef.current, editorSessionId);
    }
    setAttemptedId(documentId);
  }, [controller, document, documentId, editorSessionId]);

  return {
    document,
    restoreAttempted: attemptedId === documentId,
  };
}

/** Acquire once per panel source; re-ensure if the store entry disappears. */
export function useAcquirePanelDocument(
  controller: FilesPanelDocumentHost,
  panelId: string,
  source: FilesDocumentPanelSource | null
): void {
  const documentId = source ? controller.documentId(source) : "";
  const document = useFilesDocument(documentId);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  useLayoutEffect(() => {
    if (!source) {
      return;
    }
    return controller.acquirePanel(panelId, source);
  }, [controller, panelId, source]);

  useLayoutEffect(() => {
    const current = sourceRef.current;
    if (!current || document || controller.documentId(current) !== documentId) {
      return;
    }
    controller.ensureDocument(current);
  }, [controller, document, documentId]);
}
