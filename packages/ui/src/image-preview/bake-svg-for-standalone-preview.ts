/**
 * data: image/svg+xml previews are a separate document — host CSS variables do
 * not resolve, so nodes fill black and strokes vanish. Bake theme tokens from
 * a live paper element onto a clone before encoding, and pin intrinsic size so
 * the fullscreen image canvas can zoom.
 *
 * Markdown mermaid renders with `transparent: true`: in place, the reading
 * paper shows through. The standalone preview sits on host chrome that follows
 * the app theme, not the paper preference, so the paper color must also travel
 * inside the image — otherwise a light paper in a dark app shows the diagram
 * ink (baked dark) floating on the dark app backdrop. A first-child backdrop
 * rect carries the paper color; unlike root CSS `background`, every SVG
 * consumer (img, canvas rasterization, external viewers) paints a rect.
 */
export function bakeSvgForStandalonePreview(
  svg: SVGElement,
  options?: {
    /**
     * Optional paper root used to sample CSS tokens. Defaults to
     * `[data-slot="markdown-preview-root"]` when present, else documentElement.
     */
    paper?: HTMLElement | null;
  }
): string {
  const scope =
    options?.paper ??
    svg.closest<HTMLElement>('[data-slot="markdown-preview-root"]') ??
    document.documentElement;
  const root = getComputedStyle(scope);
  const token = (name: string): string => root.getPropertyValue(name).trim();
  const bg = token("--background");
  const fg = token("--foreground");
  const muted = token("--muted-foreground");
  const clone = svg.cloneNode(true) as SVGElement;
  ensureSvgIntrinsicSize(clone, svg);
  if (!(bg && fg)) {
    return new XMLSerializer().serializeToString(clone);
  }
  const line = `color-mix(in srgb, ${fg} 45%, ${bg})`;
  const surface = `color-mix(in srgb, ${fg} 6%, ${bg})`;
  const border = `color-mix(in srgb, ${fg} 22%, ${bg})`;
  const baked = [
    `--bg:${bg}`,
    `--fg:${fg}`,
    `--background:${bg}`,
    `--foreground:${fg}`,
    `--line:${line}`,
    // Match connector stroke — host --accent is UI chrome, not edge color.
    `--accent:${line}`,
    `--muted:${muted || line}`,
    `--surface:${surface}`,
    `--border:${border}`,
  ].join(";");
  const existing = clone.getAttribute("style")?.trim() ?? "";
  clone.setAttribute("style", existing ? `${existing};${baked}` : baked);
  paintPaperBackdrop(clone, bg);
  return new XMLSerializer().serializeToString(clone);
}

/**
 * Insert a viewport-sized rect as the first child so the baked paper color
 * sits under the whole diagram. `ensureSvgIntrinsicSize` just pinned a
 * viewBox; paint in user units so a non-zero viewBox origin (e.g. from the
 * getBBox fallback) leaves no unpainted band. Percentages anchor at
 * user-space (0,0), so they are only the no-viewBox fallback.
 */
function paintPaperBackdrop(clone: SVGElement, bg: string): void {
  const backdrop = clone.ownerDocument.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect"
  );
  const viewBox = parseViewBox(clone.getAttribute("viewBox"));
  if (viewBox) {
    backdrop.setAttribute("x", String(viewBox.x));
    backdrop.setAttribute("y", String(viewBox.y));
    backdrop.setAttribute("width", String(viewBox.width));
    backdrop.setAttribute("height", String(viewBox.height));
  } else {
    backdrop.setAttribute("width", "100%");
    backdrop.setAttribute("height", "100%");
  }
  backdrop.setAttribute("fill", bg);
  backdrop.setAttribute("data-slot", "svg-paper-backdrop");
  clone.insertBefore(backdrop, clone.firstChild);
}

function parseViewBox(
  raw: string | null
): { height: number; width: number; x: number; y: number } | null {
  if (!raw) return null;
  const parts = raw
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const [x, y, width, height] = parts as [number, number, number, number];
  if (!(width > 0 && height > 0)) return null;
  return { height, width, x, y };
}

/** Prefer viewBox so data-URL image zoom has stable naturalWidth/Height. */
function ensureSvgIntrinsicSize(clone: SVGElement, live: SVGElement): void {
  const hasWidth = Boolean(clone.getAttribute("width"));
  const hasHeight = Boolean(clone.getAttribute("height"));
  if (hasWidth && hasHeight) {
    return;
  }

  const viewBox = clone.getAttribute("viewBox")?.trim();
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/u).map(Number);
    const width = parts[2];
    const height = parts[3];
    if (
      width !== undefined &&
      height !== undefined &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      if (!hasWidth) {
        clone.setAttribute("width", String(width));
      }
      if (!hasHeight) {
        clone.setAttribute("height", String(height));
      }
      return;
    }
  }

  if (!(live instanceof SVGGraphicsElement)) {
    return;
  }
  try {
    const box = live.getBBox();
    if (box.width > 0 && box.height > 0) {
      if (!hasWidth) {
        clone.setAttribute("width", String(box.width));
      }
      if (!hasHeight) {
        clone.setAttribute("height", String(box.height));
      }
      if (!viewBox) {
        clone.setAttribute(
          "viewBox",
          `${box.x} ${box.y} ${box.width} ${box.height}`
        );
      }
    }
  } catch {
    // getBBox throws when the node is not rendered; leave attributes as-is.
  }
}
