import { useSyncExternalStore } from "react";
import {
  getDocument,
  getFilesDocumentStoreRevision,
  subscribeFilesDocumentStore,
} from "./files-document-store.ts";
import type { FilesDocument } from "./files-document-types.ts";

export function useFilesDocument(documentId: string): FilesDocument | null {
  useSyncExternalStore(
    subscribeFilesDocumentStore,
    getFilesDocumentStoreRevision,
    getFilesDocumentStoreRevision
  );
  return getDocument(documentId);
}
