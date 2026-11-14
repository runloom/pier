/**
 * Tab strip wheel guard — cancels the browser's native scroll for wheel
 * gestures that start anywhere on a tab bar.
 *
 * Dockview 7 renders the strip with its own `Scrollbar`: `.dv-tabs-container`
 * is `overflow: hidden` and dockview maps wheel deltas onto `scrollLeft` in
 * JS (`tabs.js`). At either end of the strip dockview deliberately lets the
 * event through so the page can scroll; macOS Chromium then hands the rest of
 * the gesture to the native scroll chain, where it turns into elastic
 * rubber-banding of the strip row. That contradicts the product decision
 * (K10, 2026-11-12, re-affirmed 2026-11-14): workbench chrome is not a
 * content scroll surface; "there are more tabs" is carried by the scroll-fade
 * and the overflow ▾ menu.
 *
 * The guard listens on the document in the **capture** phase and cancels the
 * default action for every wheel gesture whose target is inside
 * `.dv-tabs-and-actions-container` — tab labels, the custom scrollbar, the
 * void filler and the right actions area (overflow ▾ / new tab ＋) all count
 * as tab-bar chrome. Capture phase matters twice over:
 *
 * - `preventDefault()` does not stop propagation, so dockview's own bubble
 *   mapping still runs and the strip keeps scrolling by JS;
 * - no listener below can call `stopPropagation()` and let the gesture escape
 *   into the native scroll chain. (Measured 2026-11-14: when a wheel gesture
 *   started over the right actions area, the old `.dv-tabs-container`-only
 *   selector missed it, the first event was not cancelled, and the compositor
 *   turned the rest of the gesture into an uncancellable native scroll.)
 *
 * CSS `overscroll-behavior-x: none` on `.dv-tabs-container` stays as defense
 * for a future `scrollbars: "native"` dockview mode, but it is inert today:
 * the strip's overflow is hidden, so there is no native overscroll to
 * contain.
 */
export const TAB_STRIP_WHEEL_GUARD_SELECTOR = ".dv-tabs-and-actions-container";

export function installTabStripWheelGuard(doc: Document): () => void {
  const onWheel = (event: WheelEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest(TAB_STRIP_WHEEL_GUARD_SELECTOR) === null) {
      return;
    }
    event.preventDefault();
  };

  // Capture phase: hit the gesture before any tab-bar listener can stop
  // propagation. `passive: false` because the guard must be allowed to cancel
  // the native scroll.
  doc.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => {
    doc.removeEventListener("wheel", onWheel, { capture: true });
  };
}
