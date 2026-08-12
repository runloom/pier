/**
 * Tab strip scroll owner (session memory + layout restore).
 *
 * Maximize hides non-maximized groups (size → 0). dockview's custom scrollbar
 * then treats the strip as non-overflowing and may lose DOM scrollLeft.
 * Owner remembers scrollLeft while strips are visible and restores after
 * layout settles. dockview-core is patched so `_scrollOffset` is not zeroed
 * while temporarily non-overflowing (R2).
 *
 * Intent priority (high → low): user > layout-restore > reveal-active.
 * See docs/superpowers/specs/2026-08-11-tab-strip-scroll-ownership-gold-standard.md
 */

export interface DockviewGroupScrollTarget {
  element: HTMLElement;
  id: string;
}

export interface TabStripScrollMemory {
  dispose: () => void;
  /** Freeze memory writes (maximize entered or pre-toggle prepare). */
  freeze: () => void;
  /** True while layout-restore is in flight (K2: skip reveal-active). */
  isLayoutRestoreInFlight: () => boolean;
  /**
   * Snapshot + freeze before a layout mutation that may hide groups.
   * Safe to call even when memory is already frozen.
   */
  prepareForMaximizeLayoutMutation: () => void;
  /** Re-bind listeners; seed/prune memory for currently live groups. */
  rememberVisible: () => void;
  /** Apply memory after maximize exit, then unfreeze. */
  scheduleRestoreAndUnfreeze: () => void;
  /**
   * Force-capture all currently laid-out strips (overwrites keys).
   * Call **before** maximize / exitMaximized while groups still have size > 0.
   */
  snapshotAllVisible: () => void;
}

const TABS_CONTAINER_SELECTOR = ".dv-tabs-container";

/** Soft settle attempt; hard cap before force-complete (issue 4). */
const RESTORE_SOFT_TIMEOUT_MS = 250;
const RESTORE_HARD_TIMEOUT_MS = 2000;

/** Depth of owner-driven scrollLeft writes (ignore as user intent). */
let programmaticScrollDepth = 0;

/** Optional hook so reveal can abort without a module cycle. */
let abortRevealHook: (() => void) | null = null;

let activeMemory: TabStripScrollMemory | null = null;

export function setTabStripRevealAbortHook(hook: (() => void) | null): void {
  abortRevealHook = hook;
}

function abortScheduledReveal(): void {
  abortRevealHook?.();
}

export function setActiveTabStripScrollMemory(
  memory: TabStripScrollMemory | null
): void {
  activeMemory = memory;
}

export function getActiveTabStripScrollMemory(): TabStripScrollMemory | null {
  return activeMemory;
}

/**
 * P1 entry: call immediately before dockview maximize / exitMaximized /
 * exitMaximizedGroup so hidden groups still contribute their last offsets.
 */
export function prepareTabStripScrollsForMaximizeLayoutMutation(): void {
  activeMemory?.prepareForMaximizeLayoutMutation();
}

export function withProgrammaticTabStripScroll<T>(fn: () => T): T {
  programmaticScrollDepth += 1;
  try {
    return fn();
  } finally {
    programmaticScrollDepth -= 1;
  }
}

export function isProgrammaticTabStripScroll(): boolean {
  return programmaticScrollDepth > 0;
}

export function findTabsContainer(
  groupElement: HTMLElement
): HTMLElement | null {
  return groupElement.querySelector<HTMLElement>(TABS_CONTAINER_SELECTOR);
}

/** Remember scroll only when the strip is laid out (not maximize-hidden). */
export function captureVisibleTabStripScrolls(
  groups: readonly DockviewGroupScrollTarget[],
  into: Map<string, number> = new Map(),
  options: { overwrite?: boolean } = {}
): Map<string, number> {
  const overwrite = options.overwrite ?? true;
  for (const group of groups) {
    const tabsContainer = findTabsContainer(group.element);
    if (!(tabsContainer && tabsContainer.clientWidth > 0)) {
      continue;
    }
    if (!(overwrite || !into.has(group.id))) {
      continue;
    }
    into.set(group.id, tabsContainer.scrollLeft);
  }
  return into;
}

export function pruneTabStripScrollMemory(
  memory: Map<string, number>,
  groups: readonly DockviewGroupScrollTarget[]
): void {
  const live = new Set(groups.map((group) => group.id));
  for (const key of [...memory.keys()]) {
    if (!live.has(key)) {
      memory.delete(key);
    }
  }
}

export function restoreTabStripScrolls(
  groups: readonly DockviewGroupScrollTarget[],
  saved: ReadonlyMap<string, number>
): void {
  withProgrammaticTabStripScroll(() => {
    for (const group of groups) {
      const scrollLeft = saved.get(group.id);
      if (scrollLeft === undefined) {
        continue;
      }
      const tabsContainer = findTabsContainer(group.element);
      if (!(tabsContainer && tabsContainer.clientWidth > 0)) {
        continue;
      }
      if (tabsContainer.scrollLeft === scrollLeft) {
        continue;
      }
      // Programmatic assignment fires `scroll`, which syncs dockview Scrollbar's
      // internal `_scrollOffset` so later resize recalcs keep the restored value.
      tabsContainer.scrollLeft = scrollLeft;
    }
  });
}

/**
 * Restore after maximize exit when strips re-acquire layout size.
 *
 * Primary settle: ResizeObserver. Soft timeout retries; hard timeout force-
 * completes so freeze cannot stick forever (issue 4).
 */
export function scheduleRestoreTabStripScrolls(
  getGroups: () => readonly DockviewGroupScrollTarget[],
  saved: ReadonlyMap<string, number>,
  onSettled?: () => void
): () => void {
  let cancelled = false;
  let completed = false;
  let rafId = 0;
  let softTimeoutId: ReturnType<typeof setTimeout> | 0 = 0;
  let hardTimeoutId: ReturnType<typeof setTimeout> | 0 = 0;
  let resizeObserver: ResizeObserver | null = null;

  const cleanup = (): void => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (rafId !== 0 && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (softTimeoutId !== 0) {
      clearTimeout(softTimeoutId);
      softTimeoutId = 0;
    }
    if (hardTimeoutId !== 0) {
      clearTimeout(hardTimeoutId);
      hardTimeoutId = 0;
    }
  };

  const complete = (): void => {
    if (cancelled || completed) {
      return;
    }
    completed = true;
    cleanup();
    onSettled?.();
  };

  /** True when every remembered group is either gone or laid out (width > 0). */
  const allRememberedLaidOut = (): boolean => {
    const groups = getGroups();
    for (const groupId of saved.keys()) {
      const group = groups.find((candidate) => candidate.id === groupId);
      if (!group) {
        continue;
      }
      const tabsContainer = findTabsContainer(group.element);
      if (!(tabsContainer && tabsContainer.clientWidth > 0)) {
        return false;
      }
    }
    return true;
  };

  const tryRestore = (): void => {
    if (cancelled || completed) {
      return;
    }
    restoreTabStripScrolls(getGroups(), saved);
    if (allRememberedLaidOut()) {
      complete();
    }
  };

  tryRestore();
  if (completed || cancelled) {
    return () => {
      cancelled = true;
      cleanup();
    };
  }

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      tryRestore();
    });
    for (const group of getGroups()) {
      if (saved.has(group.id)) {
        resizeObserver.observe(group.element);
      }
    }
  }

  if (typeof requestAnimationFrame === "function") {
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      tryRestore();
    });
  }

  // Soft: retry only (do not unfreeze if still hidden).
  softTimeoutId = setTimeout(() => {
    softTimeoutId = 0;
    tryRestore();
  }, RESTORE_SOFT_TIMEOUT_MS);

  // Hard: force complete so freeze cannot stick forever.
  hardTimeoutId = setTimeout(() => {
    hardTimeoutId = 0;
    tryRestore();
    complete();
  }, RESTORE_HARD_TIMEOUT_MS);

  return () => {
    cancelled = true;
    cleanup();
  };
}

export function createTabStripScrollMemory(options: {
  getGroups: () => readonly DockviewGroupScrollTarget[];
  root: ParentNode;
}): TabStripScrollMemory {
  const memory = new Map<string, number>();
  const listened = new WeakSet<HTMLElement>();
  const listenerDisposers: Array<() => void> = [];
  let frozen = false;
  let cancelRestore: (() => void) | null = null;
  let restoreInFlight = false;

  /**
   * K3: user scroll aborts **in-flight restore/reveal** only.
   * Maximize freeze must stay until restore settle (issues 1–2).
   */
  const abortInFlightRestoreForUser = (): void => {
    if (!restoreInFlight) {
      return;
    }
    if (cancelRestore) {
      cancelRestore();
      cancelRestore = null;
    }
    restoreInFlight = false;
    frozen = false;
    abortScheduledReveal();
  };

  const attachScrollListeners = (): void => {
    const groups = options.getGroups();
    if (!groups) {
      return;
    }
    for (const group of groups) {
      const tabsContainer = findTabsContainer(group.element);
      if (!tabsContainer || listened.has(tabsContainer)) {
        continue;
      }
      listened.add(tabsContainer);
      const groupId = group.id;
      const onScroll = (): void => {
        if (tabsContainer.clientWidth <= 0) {
          return;
        }
        if (isProgrammaticTabStripScroll()) {
          // Owner restore/reveal: keep memory aligned when not frozen.
          if (!frozen) {
            memory.set(groupId, tabsContainer.scrollLeft);
          }
          return;
        }
        // Maximize hold (frozen, not yet restoring): ignore dockview/browser
        // zeroing; do not dissolve freeze or clobber the P1 snapshot.
        if (frozen && !restoreInFlight) {
          return;
        }
        // In-flight restore: user wins (K3).
        if (restoreInFlight) {
          abortInFlightRestoreForUser();
          memory.set(groupId, tabsContainer.scrollLeft);
          return;
        }
        abortScheduledReveal();
        memory.set(groupId, tabsContainer.scrollLeft);
      };
      tabsContainer.addEventListener("scroll", onScroll, { passive: true });
      listenerDisposers.push(() => {
        tabsContainer.removeEventListener("scroll", onScroll);
      });
    }
  };

  const rememberVisible = (): void => {
    attachScrollListeners();
    pruneTabStripScrollMemory(memory, options.getGroups());
    if (frozen) {
      return;
    }
    captureVisibleTabStripScrolls(options.getGroups(), memory, {
      overwrite: false,
    });
  };

  const snapshotAllVisible = (): void => {
    attachScrollListeners();
    pruneTabStripScrollMemory(memory, options.getGroups());
    captureVisibleTabStripScrolls(options.getGroups(), memory, {
      overwrite: true,
    });
  };

  const freeze = (): void => {
    frozen = true;
  };

  const prepareForMaximizeLayoutMutation = (): void => {
    snapshotAllVisible();
    freeze();
  };

  const scheduleRestoreAndUnfreeze = (): void => {
    frozen = true;
    // Cancel any prior restore; do not treat as user abort.
    cancelRestore?.();
    abortScheduledReveal();
    const snapshot = new Map(memory);
    restoreInFlight = true;
    cancelRestore = scheduleRestoreTabStripScrolls(
      options.getGroups,
      snapshot,
      () => {
        restoreInFlight = false;
        cancelRestore = null;
        frozen = false;
        pruneTabStripScrollMemory(memory, options.getGroups());
        // Re-seed from restored DOM so later freezes start from truth.
        captureVisibleTabStripScrolls(options.getGroups(), memory, {
          overwrite: true,
        });
      }
    );
  };

  const mutationObserver =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
          attachScrollListeners();
        });

  if (options.root instanceof Element) {
    mutationObserver?.observe(options.root, {
      childList: true,
      subtree: true,
    });
  }

  rememberVisible();

  return {
    dispose: () => {
      cancelRestore?.();
      cancelRestore = null;
      restoreInFlight = false;
      mutationObserver?.disconnect();
      for (const dispose of listenerDisposers) {
        dispose();
      }
      listenerDisposers.length = 0;
      memory.clear();
      frozen = false;
    },
    freeze,
    isLayoutRestoreInFlight: () => restoreInFlight,
    prepareForMaximizeLayoutMutation,
    rememberVisible,
    scheduleRestoreAndUnfreeze,
    snapshotAllVisible,
  };
}
