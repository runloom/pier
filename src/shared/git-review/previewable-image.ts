/**
 * Raster formats Pier can preview (magic-byte whitelist, same as files).
 * SVG/ICO/TIFF/HEIC stay binary notices — not in the image preview protocol.
 */
export const PREVIEWABLE_REVIEW_IMAGE_EXTENSIONS = [
  "gif",
  "jpeg",
  "jpg",
  "png",
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
