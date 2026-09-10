import type { FileDocumentLifecycle } from "../document/lifecycle.ts";
import { isSamePathOrDescendant } from "../document/paths.ts";
import {
  getDocument,
  listOpenDiskDocuments,
  markDocumentDeletedOnDisk,
  moveDiskDocumentSource,
  removeDiskDocumentForPath,
  removeDocument,
  revertDocumentToSaved,
} from "../document/store.ts";
import type { FilesDocument } from "../document/types.ts";

export class FileEditorPathMutations {
  readonly #documents: FileDocumentLifecycle;
  readonly #onRemoveDocuments: (documentIds: readonly string[]) => void;
  readonly #onPreserveAsUntitled: (
    documents: readonly FilesDocument[]
  ) => Promise<FilesDocument[]>;

  constructor(input: {
    documents: FileDocumentLifecycle;
    onRemoveDocuments: (documentIds: readonly string[]) => void;
    onPreserveAsUntitled: (
      documents: readonly FilesDocument[]
    ) => Promise<FilesDocument[]>;
  }) {
    this.#documents = input.documents;
    this.#onRemoveDocuments = input.onRemoveDocuments;
    this.#onPreserveAsUntitled = input.onPreserveAsUntitled;
  }

  async move(
    root: string,
    oldPath: string,
    newPath: string,
    affectedDocuments?: readonly FilesDocument[]
  ): Promise<void> {
    if (oldPath === newPath) {
      return;
    }
    const affected = affectedDocuments ?? listOpenDiskDocuments();
    if (!affectedDocuments) {
      this.prepare(affected);
    }
    const aliases = affected.filter(
      (document) =>
        document.source.kind === "disk" &&
        document.source.root === root &&
        !isSamePathOrDescendant(document.source.path, oldPath) &&
        !isSamePathOrDescendant(document.source.path, newPath)
    );
    await moveDiskDocumentSource(root, oldPath, newPath);
    await this.preserveAsUntitled(aliases);
  }

  remove(root: string, path: string): void {
    const documentIds = this.#documentIdsUnder(root, path);
    this.#prepare(documentIds);
    this.#onRemoveDocuments(documentIds);
    removeDiskDocumentForPath(root, path);
  }

  removeAffected(documents: readonly FilesDocument[]): void {
    const documentIds = [
      ...new Set(
        documents.flatMap((document) => {
          const current = getDocument(document.id);
          return current?.source.kind === "disk" ? [current.id] : [];
        })
      ),
    ];
    this.#prepare(documentIds);
    this.#onRemoveDocuments(documentIds);
    for (const documentId of documentIds) {
      removeDocument(documentId);
    }
  }

  markDeletedOnDisk(documents: readonly FilesDocument[]): void {
    for (const document of documents) {
      const current = getDocument(document.id);
      if (current?.source.kind === "disk") {
        markDocumentDeletedOnDisk(current.id);
      }
    }
  }

  revertToSaved(documents: readonly FilesDocument[]): void {
    for (const document of documents) {
      if (getDocument(document.id)) {
        revertDocumentToSaved(document.id);
      }
    }
  }

  async preserveAsUntitled(
    documents: readonly FilesDocument[]
  ): Promise<FilesDocument[]> {
    return await this.#onPreserveAsUntitled(documents);
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

  prepare(documents: readonly FilesDocument[]): void {
    this.#prepare(documents.map((document) => document.id));
  }
}
