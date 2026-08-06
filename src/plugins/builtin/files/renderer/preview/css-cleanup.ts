/**
 * Remove live-module style tags injected under `data-pier-live-css`.
 * Keys are either the bare moduleId or `${moduleId}::${localHash}`.
 */
export function removeLiveModuleCss(moduleId: string): void {
  if (!moduleId) {
    return;
  }
  const nodes = document.head.querySelectorAll("style[data-pier-live-css]");
  for (const node of nodes) {
    const value = node.getAttribute("data-pier-live-css");
    if (value && (value === moduleId || value.startsWith(`${moduleId}::`))) {
      node.remove();
    }
  }
}
