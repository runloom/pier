import type { FilesDocument } from "./types.ts";

type DirtyDocument = Pick<
  FilesDocument,
  "currentContents" | "deletedOnDisk" | "durabilityUnknown" | "savedContents"
>;

type DiskProtectionDocument = DirtyDocument & {
  id?: string;
};

/** One-shot force-adopt authorizations (banner "Load disk version"). */
const diskReplaceAuthorizedIds = new Set<string>();

export function authorizeDiskReplace(documentId: string): void {
  diskReplaceAuthorizedIds.add(documentId);
}

export function consumeDiskReplaceAuthorization(documentId: string): boolean {
  return diskReplaceAuthorizedIds.delete(documentId);
}

export function isDiskReplaceAuthorized(documentId: string): boolean {
  return diskReplaceAuthorizedIds.has(documentId);
}

export function clearDiskReplaceAuthorizationsForTests(): void {
  diskReplaceAuthorizedIds.clear();
}

/**
 * Canonical dirty bit: buffer diverges from last saved snapshot, or the file is
 * gone / durability is unconfirmed.
 */
export function computeDocumentDirty(document: DirtyDocument): boolean {
  return (
    document.currentContents !== document.savedContents ||
    document.deletedOnDisk ||
    document.durabilityUnknown
  );
}

/**
 * Clean buffer was only marked dirty because the backing file briefly vanished
 * (atomic rewrite: delete then create). Not a true local edit.
 */
export function isDeletionOnlyDirty(document: DirtyDocument): boolean {
  return (
    document.deletedOnDisk &&
    document.currentContents === document.savedContents &&
    !document.durabilityUnknown
  );
}

/**
 * True when external disk content must not replace the open buffer.
 *
 * Single predicate:
 * - force-adopt authorization → never protect
 * - durability unconfirmed → protect
 * - deletion-only dirty → do not protect
 * - otherwise protect only when text diverges from saved snapshot
 */
export function protectsLocalBufferFromDisk(
  document: DiskProtectionDocument
): boolean {
  if (document.id && isDiskReplaceAuthorized(document.id)) {
    return false;
  }
  if (document.durabilityUnknown) {
    return true;
  }
  if (isDeletionOnlyDirty(document)) {
    return false;
  }
  return document.currentContents !== document.savedContents;
}
