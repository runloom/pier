/**
 * Formats the review image surface can show via the file-preview protocol.
 * ICO/TIFF/HEIC stay binary notices — those codecs are not in the protocol.
 */
export const PREVIEWABLE_REVIEW_IMAGE_EXTENSIONS = [
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
] as const;

export function isPreviewableReviewImagePath(path: string): boolean {
  const base = path.split(/[\\/]/u).pop()?.toLowerCase() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) {
    return false;
  }
  const ext = base.slice(dot + 1);
  return (PREVIEWABLE_REVIEW_IMAGE_EXTENSIONS as readonly string[]).includes(
    ext
  );
}
