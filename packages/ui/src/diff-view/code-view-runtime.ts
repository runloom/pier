/**
 * Pierre CodeView runtime patches used by PierDiffView.
 *
 * 1) instanceChanged: upstream throws when a VirtualizedFileDiff/File calls back
 *    after the record left `instanceToItem` (highlight/theme/expand races during
 *    content update or membership churn). Pierre's own source notes this path as
 *    "technically broken". Swallow only that stale-callback case.
 *
 * 2) deferred membership flush: `render(true)` cannot run inside React 19
 *    useLayoutEffect (flushSync). Microtasks must ignore superseded generations
 *    and fully cleaned instances.
 */

const hardenedInstanceChanged = new WeakSet<object>();
const membershipFlushGeneration = new WeakMap<object, number>();

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
 * Queue immediate layout passes after membership/content apply.
 * Later schedules cancel earlier microtasks on the same CodeView.
 */
export function scheduleCodeViewMembershipLayoutFlush(
  instance: unknown,
  passes: number
): void {
  if (!isCodeViewRuntime(instance)) {
    return;
  }
  hardenCodeViewInstanceChanged(instance);
  const target = instance;
  const generation = (membershipFlushGeneration.get(target) ?? 0) + 1;
  membershipFlushGeneration.set(target, generation);
  queueMicrotask(() => {
    if (membershipFlushGeneration.get(target) !== generation) {
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
        if (membershipFlushGeneration.get(target) !== generation) {
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
export function codeViewMembershipFlushGenerationForTest(
  instance: unknown
): number {
  if (!instance || typeof instance !== "object") {
    return 0;
  }
  return membershipFlushGeneration.get(instance) ?? 0;
}
