export const PDF_MIN_ZOOM = 0.5;
export const PDF_MAX_ZOOM = 3;

/**
 * Link overlays sit above the selectable text layer (`z-index: 1` in
 * pdf-text-layer.css), otherwise the transparent text spans swallow clicks.
 */
export const PDF_LINK_OVERLAY_Z_INDEX = 2;

/** Chromium canvas limit per side; larger canvases silently fail to paint. */
const MAX_CANVAS_SIDE_PX = 16_384;

export function clampPdfZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1;
  }
  return Math.min(PDF_MAX_ZOOM, Math.max(PDF_MIN_ZOOM, zoom));
}

/** Keep the current page valid when a replaced document has fewer pages. */
export function clampPdfPageNumber(
  pageNumber: number,
  totalPages: number
): number {
  const total = Number.isFinite(totalPages) ? Math.max(1, totalPages) : 1;
  if (!Number.isFinite(pageNumber)) {
    return 1;
  }
  return Math.min(total, Math.max(1, Math.trunc(pageNumber)));
}

export function pdfPageRenderSize(input: {
  containerWidth: number;
  devicePixelRatio: number;
  pageHeight: number;
  pageWidth: number;
  zoom: number;
}): {
  cssHeight: number;
  cssWidth: number;
  pixelHeight: number;
  pixelWidth: number;
  scale: number;
} {
  const containerWidth =
    Number.isFinite(input.containerWidth) && input.containerWidth > 0
      ? input.containerWidth
      : input.pageWidth;
  // Fit width is a geometry relationship, not a user zoom step: clamping it
  // to PDF_MIN_ZOOM / PDF_MAX_ZOOM leaves wide pages wider than the viewport
  // and small pages unable to fill it. Only the user's zoom is clamped.
  const rawFitScale =
    input.pageWidth > 0 ? containerWidth / input.pageWidth : 1;
  const fitScale =
    Number.isFinite(rawFitScale) && rawFitScale > 0 ? rawFitScale : 1;
  const scale = fitScale * clampPdfZoom(input.zoom);
  const cssWidth = Math.max(1, input.pageWidth * scale);
  const cssHeight = Math.max(1, input.pageHeight * scale);
  const ratio = Math.min(
    2,
    Math.max(
      1,
      Number.isFinite(input.devicePixelRatio) ? input.devicePixelRatio : 1
    )
  );
  let pixelWidth = cssWidth * ratio;
  let pixelHeight = cssHeight * ratio;
  const largestSide = Math.max(pixelWidth, pixelHeight);
  if (largestSide > MAX_CANVAS_SIDE_PX) {
    const shrink = MAX_CANVAS_SIDE_PX / largestSide;
    pixelWidth *= shrink;
    pixelHeight *= shrink;
  }
  return {
    cssHeight,
    cssWidth,
    pixelHeight: Math.max(1, Math.round(pixelHeight)),
    pixelWidth: Math.max(1, Math.round(pixelWidth)),
    scale,
  };
}
