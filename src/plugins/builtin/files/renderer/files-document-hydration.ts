import {
  readPersistedDiskDraft,
  readPersistedUntitledDocument,
} from "./files-document-drafts.ts";
import {
  createDiskDocumentRecord,
  restoreUntitledMarkdownRecord,
} from "./files-document-factory.ts";
import type {
  FilesDocument,
  FilesDocumentPanelSource,
} from "./files-document-types.ts";

export type PendingUntitledRestoreSource = Extract<
  FilesDocumentPanelSource,
  { kind: "untitled" }
>;

export function applyHydratedDraftsToOpenDocuments(input: {
  documents: Map<string, FilesDocument>;
  pendingUntitledRestores: Map<string, PendingUntitledRestoreSource>;
  syncNextUntitledIndexFromId: (documentId: string) => void;
}): void {
  for (const [id, document] of input.documents) {
    if (document.source.kind !== "disk" || document.dirty) {
      continue;
    }
    const draft = readPersistedDiskDraft(
      document.source.root,
      document.source.path
    );
    if (!draft) {
      continue;
    }
    input.documents.set(
      id,
      createDiskDocumentRecord({
        draft,
        id: document.id,
        name: document.name,
        path: document.source.path,
        root: document.source.root,
      })
    );
  }

  for (const [id, source] of [...input.pendingUntitledRestores]) {
    if (input.documents.has(id)) {
      input.pendingUntitledRestores.delete(id);
      continue;
    }
    const persisted = readPersistedUntitledDocument(id);
    if (!persisted) {
      input.pendingUntitledRestores.delete(id);
      continue;
    }
    const name = persisted.name || source.name;
    const document = restoreUntitledMarkdownRecord({
      id,
      name,
      persisted,
    });
    input.documents.set(id, document);
    input.syncNextUntitledIndexFromId(id);
    input.pendingUntitledRestores.delete(id);
  }
}
