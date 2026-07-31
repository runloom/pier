import { useSyncExternalStore } from "react";
import {
  getDocument,
  getFilesDocumentStoreRevision,
  subscribeFilesDocumentStore,
} from "./store.ts";
import type { FilesDocument } from "./types.ts";

export function useFilesDocument(documentId: string): FilesDocument | null {
  useSyncExternalStore(
    subscribeFilesDocumentStore,
    getFilesDocumentStoreRevision,
    getFilesDocumentStoreRevision
  );
  return getDocument(documentId);
}
