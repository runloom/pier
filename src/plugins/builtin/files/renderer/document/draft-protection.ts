import type { FilesDraftProtectionState } from "./draft-client-types.ts";
import {
  diskDraftStorageKey,
  untitledDraftStorageKey,
} from "./draft-records.ts";
import { filesDraftProtectionState } from "./drafts.ts";
import type { FilesDocument } from "./types.ts";

export function filesDraftProtectionForDocument(
  document: FilesDocument
): FilesDraftProtectionState {
  const key =
    document.source.kind === "untitled"
      ? untitledDraftStorageKey(document.id)
      : diskDraftStorageKey(document.id);
  return filesDraftProtectionState(key);
}
