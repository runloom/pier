import {
  diskDraftStorageKey,
  untitledDraftStorageKey,
} from "./files-document-draft-records.ts";
import { filesDraftProtectionState } from "./files-document-drafts.ts";
import type { FilesDocument } from "./files-document-types.ts";
import type { FilesDraftProtectionState } from "./files-draft-client-types.ts";

export function filesDraftProtectionForDocument(
  document: FilesDocument
): FilesDraftProtectionState {
  const key =
    document.source.kind === "untitled"
      ? untitledDraftStorageKey(document.id)
      : diskDraftStorageKey(document.id);
  return filesDraftProtectionState(key);
}
