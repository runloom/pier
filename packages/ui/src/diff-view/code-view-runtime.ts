/**
 * Pierre CodeView runtime patches used by PierDiffView.
 *
 * 1) instanceChanged: upstream throws when a VirtualizedFileDiff/File calls back
 *    after the record left `instanceToItem` (highlight/theme/expand races during
 *    content update or membership churn). Pierre's own source notes this path as
 *    "technically broken". Swallow only that stale-callback case.
 *
 * 2) deferred layout flush: `render(true)` publishes through Pierre's
 *    onSnapshotChange, which wraps flushSync. React 19 cannot flush while it is
 *    rendering, so calling it from useLayoutEffect only warns and downgrades to
 *    a scheduled update. Microtasks still run before paint, so the pass keeps
 *    its pre-paint guarantee; they must ignore superseded generations and fully
 *    cleaned instances.
 *
 * 3) After those flush passes, repair stickyOffset ↔ scrollTop desync that
 *    content remeasure can leave behind (unreachable file top).
 */

const hardenedInstanceChanged = new WeakSet<object>();
const layoutFlushGeneration = new WeakMap<object, number>();

const STALE_INSTANCE_CHANGED =
  "CodeView.instanceChanged: An instance has changed that is not registered";

/** Header / subpixel slack when comparing stickyOffset spacer to scrollTop. */
const STICKY_SCROLL_SLOP_PX = 48;

interface CodeViewRuntime {
  getContainerElement?: () => Element | undefined;
  instanceChanged: (instance: unknown, layoutDirty: boolean) => void;
  instanceToItem?: Map<unknown, unknown>;
  render: (immediate?: boolean) => void;
}

interface StickyScaffoldView {
  getContainerElement?: () => HTMLElement | undefined;
  /** Logical scroll (root + pageOffset). Prefer root for paged compare. */
  getScrollTop?: () => number;
  renderState?: {
    stickyBottom: number;
    stickyHeight: number;
    stickyTop: number;
  };
  root?: HTMLElement | null;
  stickyOffset?: HTMLElement;
  updateStickyPositioning?: () => void;
}

/**
 * stickyOffset is paged (DOM). Prefer root.scrollTop over logical getScrollTop
 * (root + scrollPageOffset) so rebasing does not hard-clamp a multi-million
 * logical value into the spacer.
 */
function readPagedScaffoldScrollTop(view: StickyScaffoldView): number | null {
  const root = view.root ?? view.getContainerElement?.();
  if (root instanceof HTMLElement && Number.isFinite(root.scrollTop)) {
    return root.scrollTop;
  }
  // Test doubles often only stub getScrollTop as the paged value.
  if (typeof view.getScrollTop === "function") {
    const value = view.getScrollTop();
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function readStickyOffsetHeight(stickyOffset: HTMLElement): number {
  const fromStyle = Number.parseFloat(stickyOffset.style.height || "");
  if (Number.isFinite(fromStyle)) {
    return fromStyle;
  }
  return stickyOffset.offsetHeight;
}

/**
 * Repair stickyOffset when it no longer matches **paged** scroll position.
 *
 * Pierre advanced CodeView uses a tall `stickyOffset` spacer (≈ bufferBefore /
 * unrendered lines above the virtual window) and a `position: sticky` container
 * for the rendered line window. Mid-file scroll keeps stickyOffset ≈ root.scrollTop.
 *
 * After content remeasure (live patch refresh, estimate→loaded, annotations),
 * that spacer can stay large while paged scroll is clamped toward 0. The sticky
 * container then glues mid-file DOM to the viewport — user cannot reach the
 * real file start ("滚不到顶部").
 *
 * Call only after layout flush — never from the hot scroll emit path.
 *
 * @returns true when the scaffold was repaired.
 */
export function resyncDiffStickyScaffolding(codeView: unknown): boolean {
  if (!codeView || typeof codeView !== "object") {
    return false;
  }
  const view = codeView as StickyScaffoldView;
  const stickyOffset = view.stickyOffset;
  const renderState = view.renderState;
  if (!(stickyOffset instanceof HTMLElement) || renderState == null) {
    return false;
  }
  const pagedScrollTop = readPagedScaffoldScrollTop(view);
  if (pagedScrollTop === null) {
    return false;
  }
  const offsetHeight = readStickyOffsetHeight(stickyOffset);
  if (offsetHeight <= pagedScrollTop + STICKY_SCROLL_SLOP_PX) {
    return false;
  }

  // Invalidate so updateStickyPositioning cannot early-return on stale equals.
  renderState.stickyTop = -1;
  renderState.stickyBottom = -1;
  renderState.stickyHeight = 0;

  if (typeof view.updateStickyPositioning === "function") {
    try {
      view.updateStickyPositioning();
    } catch {
      // Incomplete test doubles / unmounted instance.
    }
  }

  const afterUpdate = readStickyOffsetHeight(stickyOffset);
  if (afterUpdate <= pagedScrollTop + STICKY_SCROLL_SLOP_PX) {
    return true;
  }

  // Still desynced. Hard-clamp spacer to paged scrollTop. Leave bottom/height
  // invalidated so a caller that omits follow-up render cannot early-return on
  // a half-updated sticky tuple. Avoid re-entrant render from here.
  const clamped = Math.max(0, pagedScrollTop);
  stickyOffset.style.height = `${clamped}px`;
  renderState.stickyTop = clamped;
  renderState.stickyBottom = -1;
  renderState.stickyHeight = 0;
  return true;
}

function isCodeViewRuntime(value: unknown): value is CodeViewRuntime {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CodeViewRuntime>;
  return (
    typeof candidate.instanceChanged === "function" &&
    typeof candidate.render === "function"
  );
}

/**
 * Patch CodeView.instanceChanged once per instance.
 * Safe to call repeatedly from layout / postRender / apply paths.
 */
export function hardenCodeViewInstanceChanged(viewer: unknown): void {
  if (!isCodeViewRuntime(viewer) || hardenedInstanceChanged.has(viewer)) {
    return;
  }
  hardenedInstanceChanged.add(viewer);
  const original = viewer.instanceChanged.bind(viewer);
  viewer.instanceChanged = function instanceChangedHardened(
    this: CodeViewRuntime,
    instance: unknown,
    layoutDirty: boolean
  ): void {
    const registered = this.instanceToItem;
    if (registered && !registered.has(instance)) {
      return;
    }
    try {
      original(instance, layoutDirty);
    } catch (error) {
      if (error instanceof Error && error.message === STALE_INSTANCE_CHANGED) {
        return;
      }
      throw error;
    }
  };
}

/**
 * Queue immediate layout passes after membership/content apply or an instant
 * scroll. Later schedules cancel earlier microtasks on the same CodeView.
 */
export function scheduleCodeViewLayoutFlush(
  instance: unknown,
  passes: number
): void {
  if (!isCodeViewRuntime(instance)) {
    return;
  }
  hardenCodeViewInstanceChanged(instance);
  const target = instance;
  const generation = (layoutFlushGeneration.get(target) ?? 0) + 1;
  layoutFlushGeneration.set(target, generation);
  queueMicrotask(() => {
    if (layoutFlushGeneration.get(target) !== generation) {
      return;
    }
    if (
      typeof target.getContainerElement === "function" &&
      target.getContainerElement() == null
    ) {
      return;
    }
    try {
      for (let pass = 0; pass < passes; pass += 1) {
        if (layoutFlushGeneration.get(target) !== generation) {
          return;
        }
        target.render(true);
      }
      if (layoutFlushGeneration.get(target) !== generation) {
        return;
      }
      // Content remeasure can leave stickyOffset ≫ scrollTop; repair before paint.
      const repaired = resyncDiffStickyScaffolding(target);
      if (repaired && layoutFlushGeneration.get(target) === generation) {
        // One more pass so the virtual line window rebuilds against the repaired
        // spacer (hard-clamp path does not re-enter render itself).
        target.render(true);
      }
    } catch {
      // unmount / incomplete test doubles — caller already accepted items
    }
  });
}

/** Test helper: current deferred-flush generation for a CodeView instance. */
export function codeViewLayoutFlushGenerationForTest(
  instance: unknown
): number {
  if (!instance || typeof instance !== "object") {
    return 0;
  }
  return layoutFlushGeneration.get(instance) ?? 0;
}
