export function fileDocumentShowsUnsavedMark(document: {
  dirty: boolean;
  needsSaveAs: boolean;
}): boolean {
  return document.dirty || document.needsSaveAs;
}
