import { documentOffsetAtLineChar } from "./files-content-search-open.ts";
import type { FilesDocument } from "./files-document-types.ts";

/** Convert a 1-based editor location to a document offset. */
export function editorOffsetForDocumentLocation(
  document:
    | Pick<FilesDocument, "currentContents" | "loadState">
    | null
    | undefined,
  line: number,
  column?: number
): number | null {
  if (document?.loadState !== "loaded") {
    return null;
  }
  return documentOffsetAtLineChar(
    document.currentContents,
    line,
    column === undefined ? 0 : Math.max(0, column - 1)
  );
}
