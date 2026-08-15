import type {
  FileDocumentFormat,
  FileWritableDocumentEol,
} from "@shared/contracts/file.ts";
import { persistUntitledDocument } from "./drafts.ts";
import { createUntitledRecord } from "./factory.ts";
import type { PendingUntitledRestoreSource } from "./hydration.ts";
import type {
  FilesDocument,
  FilesDocumentLanguage,
  FilesDocumentOrigin,
} from "./types.ts";
import {
  nextUntitledIdentity as allocateUntitledIdentity,
  type UntitledNameKind,
} from "./untitled-identity.ts";

export interface UntitledCreateStore {
  documents: Map<string, FilesDocument>;
  notify: () => void;
  pendingUntitledRestores: Map<string, PendingUntitledRestoreSource>;
  persistedUntitledExists: (id: string) => boolean;
}

export function allocateStoreUntitledIdentity(
  store: UntitledCreateStore,
  nameKind: UntitledNameKind = "plain"
): { id: string; index: number; name: string } {
  return allocateUntitledIdentity({
    idExists: (id) =>
      store.documents.has(id) ||
      store.pendingUntitledRestores.has(id) ||
      store.persistedUntitledExists(id),
    nameExists: (name) =>
      [...store.documents.values()].some(
        (document) => document.name === name
      ) ||
      [...store.pendingUntitledRestores.values()].some(
        (source) => source.name === name
      ),
    nameKind,
  });
}

export function createUntitledDocumentInStore(
  store: UntitledCreateStore,
  input: {
    contents: string;
    eol?: FileWritableDocumentEol;
    format?: FileDocumentFormat;
    language?: FilesDocumentLanguage;
    nameKind?: UntitledNameKind;
    origin?: FilesDocumentOrigin;
  }
): FilesDocument {
  const { id, name } = allocateStoreUntitledIdentity(
    store,
    input.nameKind ?? "plain"
  );
  const document = createUntitledRecord({
    contents: input.contents,
    id,
    language: input.language ?? "text",
    name,
    ...(input.eol ? { eol: input.eol } : {}),
    ...(input.format ? { format: input.format } : {}),
    ...(input.origin ? { origin: input.origin } : {}),
  });
  store.documents.set(id, document);
  persistUntitledDocument(document);
  store.notify();
  return document;
}

export function createUntitledMarkdownDocumentInStore(
  store: UntitledCreateStore,
  input: { contents: string; origin?: FilesDocumentOrigin }
): FilesDocument {
  return createUntitledDocumentInStore(store, {
    contents: input.contents,
    language: "markdown",
    nameKind: "markdown",
    ...(input.origin ? { origin: input.origin } : {}),
  });
}
