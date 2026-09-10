export function fileDocumentShowsUnsavedMark(document: {
  deletionOnlyDirty?: boolean;
  dirty: boolean;
  needsSaveAs: boolean;
}): boolean {
  if (document.deletionOnlyDirty) {
    return false;
  }
  return document.dirty || document.needsSaveAs;
}
