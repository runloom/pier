import {
  diskDraftHasRecoverableState,
  flushFilesDraftWrites,
  persistDiskDraft,
  removePersistedDiskDraft,
} from "./files-document-drafts.ts";
import { renameDiskDocumentRecord } from "./files-document-factory.ts";
import {
  diskDocumentId,
  isSamePathOrDescendant,
  rewriteDescendantPath,
} from "./files-document-paths.ts";
import type { FilesDocument } from "./files-document-types.ts";

export function createFilesDocumentPathMutationActions(input: {
  documentAliases: Map<string, string>;
  documents: Map<string, FilesDocument>;
  notify: () => void;
  removeDocumentAliasesFor: (documentId: string) => void;
}) {
  function listDiskDocumentsUnder(
    root: string,
    path: string
  ): Array<{ document: FilesDocument; id: string }> {
    const matches: Array<{ document: FilesDocument; id: string }> = [];
    for (const [id, document] of input.documents) {
      if (
        document.source.kind === "disk" &&
        document.source.root === root &&
        isSamePathOrDescendant(document.source.path, path)
      ) {
        matches.push({ document, id });
      }
    }
    return matches;
  }

  return {
    async moveDiskDocumentSource(
      root: string,
      oldPath: string,
      newPath: string
    ): Promise<void> {
      if (oldPath === newPath) {
        return;
      }

      const entries = listDiskDocumentsUnder(root, oldPath);
      if (entries.length === 0) {
        return;
      }

      const previousDrafts: Array<{
        id: string;
        nextId: string;
        path: string;
      }> = [];
      for (const entry of entries) {
        if (entry.document.source.kind !== "disk") {
          continue;
        }
        const previousPath = entry.document.source.path;
        const nextPath = rewriteDescendantPath(previousPath, oldPath, newPath);
        const defaultOldId = diskDocumentId(root, previousPath);
        const nextId =
          entry.document.id === defaultOldId
            ? diskDocumentId(root, nextPath)
            : entry.document.id;
        const nextDocument = renameDiskDocumentRecord(entry.document, {
          id: nextId,
          path: nextPath,
          root,
        });

        if (entry.id !== nextId) {
          input.documents.delete(entry.id);
          input.documentAliases.set(entry.id, nextId);
        }
        input.documentAliases.set(defaultOldId, nextId);
        input.documents.set(nextId, nextDocument);
        if (diskDraftHasRecoverableState(nextDocument)) {
          persistDiskDraft(nextDocument);
          previousDrafts.push({
            id: entry.document.id,
            nextId,
            path: previousPath,
          });
        } else {
          removePersistedDiskDraft(entry.document.id, {
            path: previousPath,
            root,
          });
        }
      }
      input.notify();
      if (previousDrafts.length > 0) {
        await flushFilesDraftWrites();
        for (const previous of previousDrafts) {
          if (previous.id !== previous.nextId) {
            removePersistedDiskDraft(previous.id, {
              path: previous.path,
              root,
            });
          }
        }
        await flushFilesDraftWrites();
      }
    },

    removeDiskDocumentForPath(root: string, path: string): void {
      const entries = listDiskDocumentsUnder(root, path);
      if (entries.length === 0) {
        return;
      }

      for (const entry of entries) {
        if (entry.document.source.kind === "disk") {
          removePersistedDiskDraft(entry.document.id, {
            path: entry.document.source.path,
            root,
          });
        }
        input.documents.delete(entry.id);
        input.removeDocumentAliasesFor(entry.id);
        input.removeDocumentAliasesFor(
          diskDocumentId(
            root,
            entry.document.source.kind === "disk"
              ? entry.document.source.path
              : path
          )
        );
      }
      input.notify();
    },
  };
}
