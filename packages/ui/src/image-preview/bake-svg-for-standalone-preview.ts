/**
 * data: image/svg+xml previews are a separate document — host CSS variables do
 * not resolve, so nodes fill black and strokes vanish. Bake theme tokens from
 * a live paper element onto a clone before encoding, and pin intrinsic size so
 * the fullscreen image canvas can zoom.
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
  return new XMLSerializer().serializeToString(clone);
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

/** @deprecated Prefer bakeSvgForStandalonePreview — mermaid call sites. */
export function bakeMermaidSvgForStandalonePreview(svg: SVGElement): string {
  return bakeSvgForStandalonePreview(svg);
}
