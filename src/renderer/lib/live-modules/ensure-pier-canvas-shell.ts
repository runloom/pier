import shellCss from "./pier-canvas-shell.css?inline";

const STYLE_ATTR = "data-pier-canvas-shell-style";

/**
 * Install once: framework-agnostic classes that mirror pier/canvas layout
 * primitives for Vue / Solid / Svelte canvases (React continues to use pier/canvas).
 */
export function ensurePierCanvasShellStyles(): void {
  if (typeof document === "undefined") {
    return;
  }
  if (document.head.querySelector(`style[${STYLE_ATTR}]`)) {
    return;
  }
  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTR, "");
  style.textContent = shellCss;
  document.head.appendChild(style);
}
