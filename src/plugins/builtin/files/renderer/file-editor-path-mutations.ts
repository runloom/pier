import type { FileDocumentLifecycle } from "./file-document-lifecycle.ts";
import { isSamePathOrDescendant } from "./files-document-paths.ts";
import {
  listOpenDiskDocuments,
  moveDiskDocumentSource,
  removeDiskDocumentForPath,
} from "./files-document-store.ts";

export class FileEditorPathMutations {
  readonly #documents: FileDocumentLifecycle;
  readonly #onRemoveDocuments: (documentIds: readonly string[]) => void;

  constructor(input: {
    documents: FileDocumentLifecycle;
    onRemoveDocuments: (documentIds: readonly string[]) => void;
  }) {
    this.#documents = input.documents;
    this.#onRemoveDocuments = input.onRemoveDocuments;
  }

  move(root: string, oldPath: string, newPath: string): void {
    if (oldPath === newPath) {
      return;
    }
    const documentIds = this.#documentIdsUnder(root, oldPath);
    this.#prepare(documentIds);
    moveDiskDocumentSource(root, oldPath, newPath);
  }

  remove(root: string, path: string): void {
    const documentIds = this.#documentIdsUnder(root, path);
    this.#prepare(documentIds);
    this.#onRemoveDocuments(documentIds);
    removeDiskDocumentForPath(root, path);
  }

  #documentIdsUnder(root: string, path: string): string[] {
    return listOpenDiskDocuments()
      .filter(
        (document) =>
          document.source.kind === "disk" &&
          document.source.root === root &&
          isSamePathOrDescendant(document.source.path, path)
      )
      .map((document) => document.id);
  }

  #prepare(documentIds: readonly string[]): void {
    for (const documentId of documentIds) {
      this.#documents.preparePathMutation(documentId);
    }
  }
}
