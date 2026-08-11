/**
 * Tab strip horizontal scroll-fade — single source with product ScrollArea fades.
 *
 * Dockview owns `.dv-tabs-container` (we cannot put Tailwind `scroll-fade-x` or
 * wrap it in `@pier/ui/ScrollArea`). Same escape hatch as the file tree:
 * {@link scrollFadeUnsafeCss} emits the mask + scroll-driven animation CSS for a
 * selector we do not control as a React tree.
 *
 * Install is ref-counted so overlapping lifetimes (Strict Mode / tests) do not
 * tear down styles still needed by another holder.
 */
import { scrollFadeUnsafeCss } from "@pier/ui/scroll-area.tsx";

export const TAB_STRIP_SCROLL_FADE_STYLE_ID = "pier-tab-strip-scroll-fade";

/** Scroll host selector (must stay aligned with dockview DOM). */
export const TAB_STRIP_SCROLL_FADE_SELECTOR =
  ".dockview-theme-pier .dv-tabs-container";

export const TAB_STRIP_SCROLL_FADE_CSS = scrollFadeUnsafeCss({
  fade: "horizontal",
  profile: "short",
  selector: TAB_STRIP_SCROLL_FADE_SELECTOR,
});

/** Per-document install refcounts (weak so documents can GC). */
const installRefCountByDocument = new WeakMap<Document, number>();

export function installTabStripScrollFadeStyles(
  doc: Document = document
): () => void {
  const previous = installRefCountByDocument.get(doc) ?? 0;
  installRefCountByDocument.set(doc, previous + 1);

  if (previous === 0) {
    let style = doc.getElementById(TAB_STRIP_SCROLL_FADE_STYLE_ID);
    if (!style) {
      style = doc.createElement("style");
      style.id = TAB_STRIP_SCROLL_FADE_STYLE_ID;
      style.setAttribute("data-pier-owned", "tab-strip-scroll-fade");
      style.textContent = TAB_STRIP_SCROLL_FADE_CSS;
      doc.head.append(style);
    }
  }

  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    const count = installRefCountByDocument.get(doc) ?? 0;
    const next = Math.max(0, count - 1);
    if (next === 0) {
      installRefCountByDocument.delete(doc);
      doc.getElementById(TAB_STRIP_SCROLL_FADE_STYLE_ID)?.remove();
      return;
    }
    installRefCountByDocument.set(doc, next);
  };
}
