/**
 * Markdown Mermaid display sizing (Zed-style natural viewport).
 *
 * Layout engines emit an intrinsic SVG size (viewBox / width×height). The
 * preview must treat that as the design size at zoom=1:
 * - Never scale up to fill the column (that produces huge nodes on tall graphs).
 * - Only scale down when the diagram is wider than the container.
 */

export interface DiagramSize {
  height: number;
  width: number;
}

/**
 * Read intrinsic CSS-pixel size from SVG markup (no DOM required).
 * Prefers viewBox; falls back to width/height attributes.
 */
export function parseSvgIntrinsicSize(svgMarkup: string): DiagramSize | null {
  const viewBox = /viewBox\s*=\s*["']([^"']+)["']/iu.exec(svgMarkup)?.[1];
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/u)
      .map(Number);
    if (
      parts.length === 4 &&
      parts.every((value) => Number.isFinite(value)) &&
      (parts[2] ?? 0) > 0 &&
      (parts[3] ?? 0) > 0
    ) {
      return { height: parts[3] ?? 0, width: parts[2] ?? 0 };
    }
  }

  const width = parseSvgLength(
    /<svg\b[^>]*\bwidth\s*=\s*["']([^"']+)["']/iu.exec(svgMarkup)?.[1]
  );
  const height = parseSvgLength(
    /<svg\b[^>]*\bheight\s*=\s*["']([^"']+)["']/iu.exec(svgMarkup)?.[1]
  );
  if (width && height && width > 0 && height > 0) {
    return { height, width };
  }
  return null;
}

/**
 * Natural size at `zoom`, capped so width never exceeds `containerWidth`.
 * Scale factor is never greater than `zoom` (default 1 → never enlarge).
 */
export function computeNaturalCappedSize(
  intrinsic: DiagramSize,
  containerWidth: number,
  zoom = 1
): DiagramSize {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const naturalWidth = intrinsic.width * safeZoom;
  const naturalHeight = intrinsic.height * safeZoom;

  if (
    !(naturalWidth > 0 && naturalHeight > 0 && containerWidth > 0) ||
    naturalWidth <= containerWidth
  ) {
    return { height: naturalHeight, width: naturalWidth };
  }

  const scale = containerWidth / naturalWidth;
  return {
    height: naturalHeight * scale,
    width: containerWidth,
  };
}

/** Apply pixel display size to a live SVG element (host preview only). */
export function applySvgDisplaySize(svg: SVGElement, size: DiagramSize): void {
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  // Keep viewBox for correct aspect; drive layout via CSS pixels.
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.style.display = "block";
  svg.style.width = `${size.width}px`;
  svg.style.height = `${size.height}px`;
  svg.style.maxWidth = "none";
}

/**
 * Width available for children inside a padded shell.
 * `clientWidth` includes padding; subtract horizontal padding so natural-capped
 * scale-down matches the SVG slot (same idea as `readScrollContentWidthPx`).
 */
export function contentBoxWidthPx(element: HTMLElement): number {
  const styles = getComputedStyle(element);
  const padX =
    (Number.parseFloat(styles.paddingLeft) || 0) +
    (Number.parseFloat(styles.paddingRight) || 0);
  return Math.max(0, element.clientWidth - padX);
}

function parseSvgLength(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.endsWith("%")) return null;
  const match = /^([\d.]+)(?:px)?$/iu.exec(trimmed);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}
