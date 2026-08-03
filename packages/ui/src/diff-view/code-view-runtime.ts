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
 */

const hardenedInstanceChanged = new WeakSet<object>();
const layoutFlushGeneration = new WeakMap<object, number>();

const STALE_INSTANCE_CHANGED =
  "CodeView.instanceChanged: An instance has changed that is not registered";

interface CodeViewRuntime {
  getContainerElement?: () => Element | undefined;
  instanceChanged: (instance: unknown, layoutDirty: boolean) => void;
  instanceToItem?: Map<unknown, unknown>;
  render: (immediate?: boolean) => void;
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
