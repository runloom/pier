import type {
  FileDocumentReadResult,
  FilePreviewImageMime,
} from "@shared/contracts/file.ts";
import { classifyPreviewSvgMarkupText } from "@shared/file-preview/svg-markup.ts";

export function markdownImagePreviewFromDocument(
  document: FileDocumentReadResult
): { mime: FilePreviewImageMime; revision: string } | null {
  if (document.kind === "image") {
    return { mime: document.mime, revision: document.revision };
  }
  if (
    document.kind === "text" &&
    classifyPreviewSvgMarkupText(document.contents)
  ) {
    return { mime: "image/svg+xml", revision: document.revision };
  }
  return null;
}
