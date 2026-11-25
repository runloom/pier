import {
  scrollTabStripByWheel,
  TABS_CONTAINER_SELECTOR,
} from "@/lib/workspace/tab-strip-scroll.ts";

/**
 * Tab strip wheel guard — the single owner of wheel-driven scrolling on a
 * dockview tab bar.
 *
 * Product decision K10 (2026-11-12, re-affirmed 2026-11-14 and 2026-11-25):
 * workbench chrome is not a content scroll surface. "There are more tabs" is
 * carried by the scroll-fade and the overflow ▾ menu, never by the strip
 * moving on its own.
 *
 * The strip is not natively scrollable: `dockview` 7 wraps it in its custom
 * `Scrollbar` and `.dv-scrollable > .dv-tabs-container` resolves to
 * `overflow: hidden` (measured in a real window), so every visible movement is
 * a JS write to `scrollLeft`. Two dockview writers compete for that:
 *
 * - `tabs.js` maps `deltaX || deltaY` and `stopPropagation()`s when it scrolls,
 *   but **returns without consuming at either end** so the gesture can escape;
 * - `Scrollbar` keeps its own `_scrollOffset`, only ever adds `deltaY`, and
 *   replays that offset into `scrollLeft` whenever it recalculates (resize,
 *   scroll sync). Measured 2026-11-25: a recalc wrote `0` over a strip that
 *   was sitting at `_max`, i.e. the strip can be yanked to a stale position.
 *
 * The browser compositor is not the cause here: Electron's
 * `scroll_bounce_flag.patch` rewires `IsElasticOverscrollSupported()` /
 * `IsElasticOverscrollEnabledOnRoot()` to `HasSwitch("scroll-bounce")`, and
 * `web_contents_preferences.cc` leaves `scroll_bounce_ = false` on macOS
 * unless `webPreferences.scrollBounce` is set — so
 * `enable_elastic_overscroll_for_subscroll` stays false regardless of
 * `OverscrollEffectOnNonRootScrollers`, and `--scroll-bounce` appears in no
 * Pier process. The `overscroll-behavior: none` rules in `globals.css` stay as
 * defence for a future `scrollbars: "native"` mode, not as the fix.
 *
 * What this guard does, on the document in the **capture** phase:
 *
 * 1. `preventDefault()` for every wheel gesture over
 *    `.dv-tabs-and-actions-container` — tab labels, the custom scrollbar, the
 *    void filler and the right actions area (overflow ▾ / new tab ＋) are all
 *    chrome. Capture matters: a downstream `stopPropagation()` cannot keep the
 *    gesture away from the native scroll chain. (Measured 2026-11-14: when a
 *    gesture started over the right actions area and the old
 *    `.dv-tabs-container`-only selector missed it, the compositor took the
 *    rest of the gesture as an uncancellable native scroll.)
 * 2. Applies exactly one clamped step itself, through the strip's scroll owner
 *    (`scrollTabStripByWheel`), so the strip moves only by the gesture's
 *    dominant axis and never outside `[0, max]`.
 * 3. `stopPropagation()` so neither dockview writer runs: two writers with two
 *    accumulators is what turns the end of a gesture into a jump.
 */
export const TAB_STRIP_WHEEL_GUARD_SELECTOR = ".dv-tabs-and-actions-container";

export function installTabStripWheelGuard(doc: Document): () => void {
  const onWheel = (event: WheelEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const strip = target.closest(TAB_STRIP_WHEEL_GUARD_SELECTOR);
    if (strip === null) {
      return;
    }
    event.preventDefault();
    const container = strip.querySelector(TABS_CONTAINER_SELECTOR);
    if (container !== null) {
      scrollTabStripByWheel(container, event.deltaX, event.deltaY);
    }
    event.stopPropagation();
  };

  // Capture phase: hit the gesture before any tab-bar listener can stop
  // propagation. `passive: false` because the guard must be allowed to cancel
  // the native scroll.
  doc.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => {
    doc.removeEventListener("wheel", onWheel, { capture: true });
  };
}
