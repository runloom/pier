import type { FilesDocument } from "./types.ts";

type DiskProtectionDocument = Pick<
  FilesDocument,
  | "currentContents"
  | "deletedOnDisk"
  | "dirty"
  | "durabilityUnknown"
  | "savedContents"
>;

/**
 * Clean buffer was only marked dirty because the backing file briefly vanished
 * (atomic rewrite: delete then create). Not a true local edit.
 *
 * Local intent under deletion is proxied solely by
 * `currentContents === savedContents`. Dirty-with-equal-contents without
 * `deletedOnDisk` still protects via `protectsLocalBufferFromDisk`.
 */
export function isDeletionOnlyDirty(document: DiskProtectionDocument): boolean {
  return (
    document.deletedOnDisk &&
    document.currentContents === document.savedContents &&
    !document.durabilityUnknown
  );
}

/** True when external disk content must not replace the open buffer. */
export function protectsLocalBufferFromDisk(
  document: DiskProtectionDocument
): boolean {
  return (
    (document.dirty || document.durabilityUnknown) &&
    !isDeletionOnlyDirty(document)
  );
}
