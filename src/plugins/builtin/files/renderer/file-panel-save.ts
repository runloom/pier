import type { FilePanelFilesApi } from "./file-panel-hooks.ts";
import { errorMessage, isFileConflictError } from "./file-panel-hooks.ts";
import {
  getDocument,
  markDocumentSaved,
  markDocumentSaveError,
  setDocumentConflictContents,
} from "./files-document-store.ts";
import type { FileViewMode } from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";

export type FileConflictChoice = "cancel" | "compare" | "overwrite";

async function writeDiskDocument(input: {
  contents: string;
  expectedMtimeMs: number | null;
  files: FilePanelFilesApi;
  force?: boolean;
  path: string;
  root: string;
}): Promise<{ mtimeMs: number }> {
  const result = await input.files.writeText({
    contents: input.contents,
    ...(input.force || input.expectedMtimeMs == null
      ? {}
      : { expectedMtimeMs: input.expectedMtimeMs }),
    path: input.path,
    root: input.root,
  });
  return { mtimeMs: result.mtimeMs };
}

export async function saveDiskDocument(input: {
  documentId: string;
  files: FilePanelFilesApi | undefined;
  onModeChange?: (mode: FileViewMode) => void;
  onSavingChange?: (saving: boolean) => void;
  resolveConflict?: () => Promise<FileConflictChoice>;
  t: FilesTranslate;
}): Promise<boolean> {
  const document = getDocument(input.documentId);
  if (!(input.files && document) || document.source.kind !== "disk") {
    return false;
  }
  if (
    !(document.capabilities.includes("save") && document.dirty) ||
    document.readOnly ||
    document.loadState !== "loaded"
  ) {
    return !document.dirty;
  }

  const savedContents = document.currentContents;
  input.onSavingChange?.(true);
  try {
    let result: { mtimeMs: number };
    try {
      result = await writeDiskDocument({
        contents: savedContents,
        expectedMtimeMs: document.baseMtimeMs,
        files: input.files,
        path: document.source.path,
        root: document.source.root,
      });
    } catch (writeError) {
      if (!(isFileConflictError(writeError) && input.resolveConflict)) {
        throw writeError;
      }
      const choice = await input.resolveConflict();
      if (choice === "cancel") {
        return false;
      }
      if (choice === "compare") {
        const diskContents = await input.files.readText({
          path: document.source.path,
          root: document.source.root,
        });
        setDocumentConflictContents(document.id, diskContents);
        input.onModeChange?.("diff");
        return false;
      }
      result = await writeDiskDocument({
        contents: savedContents,
        expectedMtimeMs: null,
        files: input.files,
        force: true,
        path: document.source.path,
        root: document.source.root,
      });
    }
    markDocumentSaved(document.id, savedContents, result.mtimeMs);
    return true;
  } catch (writeError) {
    markDocumentSaveError(
      document.id,
      errorMessage(
        writeError,
        input.t(
          "filePanel.errors.save.fallback",
          "Unable to save file contents."
        )
      )
    );
    return false;
  } finally {
    input.onSavingChange?.(false);
  }
}
