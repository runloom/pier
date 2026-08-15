import type {
  FileDocumentFormat,
  FileDocumentReadResult,
  FileDocumentWriteResult,
  FileWritableDocumentEol,
} from "@shared/contracts/file.ts";
import {
  withDocumentConflictContents,
  withDocumentContents,
  withDocumentDeletedOnDisk,
  withDocumentDiskConflict,
  withDocumentDiskConflictDismissed,
  withDocumentDurabilityConfirmed,
  withDocumentDurabilityError,
  withDocumentError,
  withDocumentLanguage,
  withDocumentLoaded,
  withDocumentLoading,
  withDocumentNormalizedEol,
  withDocumentPathReconciled,
  withDocumentReadResult,
  withDocumentSaved,
  withDocumentSaveEol,
  withDocumentSaveError,
  withDocumentSaveFormat,
  withDocumentSaveIdle,
  withDocumentSaving,
  withDocumentWritten,
} from "./reducers.ts";
import type { FilesDocument, FilesDocumentLanguage } from "./types.ts";

type ReplaceDocument = (
  documentId: string,
  update: (document: FilesDocument) => FilesDocument
) => void;

export function createFilesDocumentStateActions(replace: ReplaceDocument) {
  return {
    markDocumentDeletedOnDisk(documentId: string): void {
      replace(documentId, withDocumentDeletedOnDisk);
    },
    markDocumentDiskConflict(documentId: string): void {
      replace(documentId, withDocumentDiskConflict);
    },
    dismissDocumentDiskConflict(documentId: string): void {
      replace(documentId, withDocumentDiskConflictDismissed);
    },
    markDocumentDurabilityConfirmed(
      documentId: string,
      revision: string
    ): void {
      replace(documentId, (document) =>
        withDocumentDurabilityConfirmed(document, revision)
      );
    },
    markDocumentDurabilityError(documentId: string, message: string): void {
      replace(documentId, (document) =>
        withDocumentDurabilityError(document, message)
      );
    },
    markDocumentError(documentId: string, message: string): void {
      replace(documentId, (document) => withDocumentError(document, message));
    },
    markDocumentLoaded(
      documentId: string,
      contents: string,
      baseMtimeMs: number | null = null
    ): void {
      replace(documentId, (document) =>
        withDocumentLoaded(document, contents, baseMtimeMs)
      );
    },
    markDocumentLoading(documentId: string): void {
      replace(documentId, withDocumentLoading);
    },
    markDocumentPathReconciled(
      documentId: string,
      result: FileDocumentReadResult
    ): void {
      replace(documentId, (document) =>
        withDocumentPathReconciled(document, result)
      );
    },
    markDocumentReadResult(
      documentId: string,
      result: FileDocumentReadResult
    ): void {
      replace(documentId, (document) =>
        withDocumentReadResult(document, result)
      );
    },
    markDocumentSaved(
      documentId: string,
      savedContents: string,
      baseMtimeMs?: number | null
    ): void {
      replace(documentId, (document) =>
        withDocumentSaved(document, savedContents, baseMtimeMs)
      );
    },
    markDocumentSaveError(documentId: string, message: string): void {
      replace(documentId, (document) =>
        withDocumentSaveError(document, message)
      );
    },
    markDocumentSaveIdle(documentId: string): void {
      replace(documentId, withDocumentSaveIdle);
    },
    markDocumentSaving(documentId: string): void {
      replace(documentId, withDocumentSaving);
    },
    markDocumentWritten(
      documentId: string,
      savedContents: string,
      result: Extract<FileDocumentWriteResult, { kind: "written" }>
    ): void {
      replace(documentId, (document) =>
        withDocumentWritten(document, savedContents, result)
      );
    },
    normalizeDocumentEol(documentId: string, eol: "crlf" | "lf"): void {
      replace(documentId, (document) =>
        withDocumentNormalizedEol(document, eol)
      );
    },
    setDocumentLanguage(
      documentId: string,
      language: FilesDocumentLanguage
    ): void {
      replace(documentId, (document) =>
        withDocumentLanguage(document, language)
      );
    },
    setDocumentSaveEol(documentId: string, eol: FileWritableDocumentEol): void {
      replace(documentId, (document) => withDocumentSaveEol(document, eol));
    },
    setDocumentSaveFormat(
      documentId: string,
      format: FileDocumentFormat
    ): void {
      replace(documentId, (document) =>
        withDocumentSaveFormat(document, format)
      );
    },
    setDocumentConflictContents(
      documentId: string,
      contents: string | null
    ): void {
      replace(documentId, (document) =>
        withDocumentConflictContents(document, contents)
      );
    },
    updateDocumentContents(documentId: string, contents: string): void {
      replace(documentId, (document) =>
        withDocumentContents(document, contents)
      );
    },
  };
}
