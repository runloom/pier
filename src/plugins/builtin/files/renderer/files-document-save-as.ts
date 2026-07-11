import type { FileDocumentWriteResult } from "@shared/contracts/file.ts";
import type { FileSaveTarget } from "@shared/contracts/file-save-target.ts";
import {
  persistDiskDraft,
  removePersistedDiskDraft,
} from "./files-document-drafts.ts";
import { diskDocumentId } from "./files-document-paths.ts";
import type { FilesDocument } from "./files-document-types.ts";
import { languageForPath } from "./files-language-detection.ts";

export function buildSaveAsTargetDocument(input: {
  result: Extract<FileDocumentWriteResult, { kind: "written" }>;
  savedContents: string;
  source: FilesDocument;
  target: FileSaveTarget;
}): FilesDocument {
  if (!(input.source.format && input.source.eol)) {
    throw new Error("The source document cannot be saved as text");
  }
  const targetId = diskDocumentId(input.target.root, input.target.path);
  return {
    ...input.source,
    canonicalPath: input.result.canonicalPath,
    capabilities: ["save", "saveAs"],
    deletedOnDisk: false,
    dirty: input.source.currentContents !== input.savedContents,
    diskConflict: false,
    durabilityUnknown: input.result.durability === "unknown",
    error: null,
    hasBackingStore: true,
    id: targetId,
    language: languageForPath(input.target.path),
    loadState: "loaded",
    mode: input.result.mode,
    name:
      input.target.path.split("/").filter(Boolean).at(-1) ?? input.target.path,
    needsSaveAs: false,
    readOnly: false,
    readOnlyReason: null,
    revision: input.result.revision,
    savedContents: input.savedContents,
    saveState: "idle",
    size: input.result.size,
    source: {
      kind: "disk",
      path: input.target.path,
      root: input.target.root,
    },
  };
}

export function createFilesDocumentSaveAsActions(input: {
  getDocument: (documentId: string) => FilesDocument | null;
  notify: () => void;
  setDocument: (documentId: string, document: FilesDocument) => void;
}) {
  return {
    adoptDocumentSaveAsTarget(request: {
      result: Extract<FileDocumentWriteResult, { kind: "written" }>;
      savedContents: string;
      sourceDocumentId: string;
      target: FileSaveTarget;
    }): FilesDocument {
      const source = input.getDocument(request.sourceDocumentId);
      if (!(source?.format && source.eol) || source.eol === "mixed") {
        throw new Error("The source document cannot be saved as text");
      }
      const targetId = diskDocumentId(request.target.root, request.target.path);
      const existing = input.getDocument(targetId);
      if (
        existing &&
        existing.id !== source.id &&
        (existing.dirty || existing.durabilityUnknown || existing.needsSaveAs)
      ) {
        throw new Error("The save target has protected unsaved changes");
      }
      const nextDocument = buildSaveAsTargetDocument({
        result: request.result,
        savedContents: request.savedContents,
        source,
        target: request.target,
      });
      input.setDocument(targetId, nextDocument);
      if (nextDocument.dirty || nextDocument.durabilityUnknown) {
        persistDiskDraft(nextDocument);
      } else {
        removePersistedDiskDraft(request.target.root, request.target.path);
      }
      input.notify();
      return nextDocument;
    },
  };
}
