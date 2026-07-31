/**
 * Review 阅读会话：锁住「正在读」的坐标系。
 * - 非 idle 时 pinnedPrefix 只增不减（相对仍 candidate 的集合）
 * - 成员选择与 retention sticky 消费 pin，禁止 cap 裁掉视口/选中/导航目标
 * - 不做单文件降级；性能交给 CodeView 虚拟滚动 + 按需 load
 */

export type ReviewReadingMode =
  | "idle"
  | "navigating"
  | "userScrolling"
  | "refreshing";

/** 用户滚动结束后多久回到 idle，允许 cap 收敛。 */
export const REVIEW_READING_SCROLL_IDLE_MS = 200;

export function isReadingProtectedMode(mode: ReviewReadingMode): boolean {
  return mode !== "idle";
}

/**
 * 计算不可裁 pin 前缀（index 序）。
 * 非 idle：保留 previousPinned∩candidates，再并上 base（选中/视口/导航目标）。
 */
export function computePinnedPrefixEntryKeys(options: {
  readonly candidates: ReadonlySet<string>;
  readonly entryKeysInOrder: readonly string[];
  readonly mode: ReviewReadingMode;
  readonly navigationTargetEntryKey?: string | null;
  readonly previousPinnedEntryKeys?: readonly string[];
  readonly selectedEntryKey?: string | null;
  readonly viewportEntryKeys?: readonly string[];
}): string[] {
  const {
    candidates,
    entryKeysInOrder,
    mode,
    navigationTargetEntryKey = null,
    previousPinnedEntryKeys = [],
    selectedEntryKey = null,
    viewportEntryKeys = [],
  } = options;
  const base = new Set<string>();
  const add = (entryKey: string | null | undefined): void => {
    if (
      entryKey !== null &&
      entryKey !== undefined &&
      candidates.has(entryKey)
    ) {
      base.add(entryKey);
    }
  };
  add(selectedEntryKey);
  add(navigationTargetEntryKey);
  for (const entryKey of viewportEntryKeys) {
    add(entryKey);
  }

  const pinned = new Set<string>(base);
  if (isReadingProtectedMode(mode)) {
    for (const entryKey of previousPinnedEntryKeys) {
      if (candidates.has(entryKey)) {
        pinned.add(entryKey);
      }
    }
  }

  return entryKeysInOrder.filter((entryKey) => pinned.has(entryKey));
}

export interface GitReviewReadingSessionSnapshot {
  readonly mode: ReviewReadingMode;
  readonly navigationTargetEntryKey: string | null;
  readonly pinnedPrefixEntryKeys: readonly string[];
  readonly selectedEntryKey: string | null;
  readonly viewportEntryKeys: readonly string[];
}

export interface GitReviewReadingSession {
  beginNavigating(entryKey: string): void;
  beginRefreshing(): void;
  endNavigating(): void;
  endRefreshing(): void;
  getMode(): ReviewReadingMode;
  getNavigationTargetEntryKey(): string | null;
  getPinnedPrefixEntryKeys(): readonly string[];
  getSnapshot(): GitReviewReadingSessionSnapshot;
  /** 用户滚动：进入 userScrolling，debounce 后 idle。 */
  noteUserScroll(): void;
  setSelectedEntryKey(entryKey: string | null): void;
  /**
   * 用当前 candidates/demand 视口重算 pin。
   * session.sync 每拍调用；返回最新 pin（index 序）。
   */
  syncPinnedPrefix(options: {
    readonly candidates: ReadonlySet<string>;
    readonly entryKeysInOrder: readonly string[];
    readonly selectedEntryKey: string | null;
    readonly viewportEntryKeys: readonly string[];
  }): readonly string[];
}

export function createGitReviewReadingSession(options?: {
  readonly scrollIdleMs?: number;
}): GitReviewReadingSession {
  const scrollIdleMs = options?.scrollIdleMs ?? REVIEW_READING_SCROLL_IDLE_MS;
  let mode: ReviewReadingMode = "idle";
  let pinnedPrefixEntryKeys: readonly string[] = [];
  let selectedEntryKey: string | null = null;
  let navigationTargetEntryKey: string | null = null;
  let viewportEntryKeys: readonly string[] = [];
  let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearScrollIdleTimer = (): void => {
    if (scrollIdleTimer !== null) {
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = null;
    }
  };

  const recomputePin = (
    candidates: ReadonlySet<string>,
    entryKeysInOrder: readonly string[]
  ): readonly string[] => {
    pinnedPrefixEntryKeys = computePinnedPrefixEntryKeys({
      candidates,
      entryKeysInOrder,
      mode,
      navigationTargetEntryKey,
      previousPinnedEntryKeys: pinnedPrefixEntryKeys,
      selectedEntryKey,
      viewportEntryKeys,
    });
    return pinnedPrefixEntryKeys;
  };

  return {
    beginNavigating(entryKey: string): void {
      clearScrollIdleTimer();
      mode = "navigating";
      navigationTargetEntryKey = entryKey;
      selectedEntryKey = entryKey;
    },
    beginRefreshing(): void {
      clearScrollIdleTimer();
      // 刷新不得弱于当前 pin；进入 refreshing 后 pin 只增不减直到 end
      mode = "refreshing";
      navigationTargetEntryKey = null;
    },
    endNavigating(): void {
      if (mode === "navigating") {
        mode = "idle";
      }
      navigationTargetEntryKey = null;
    },
    endRefreshing(): void {
      if (mode === "refreshing") {
        mode = "idle";
      }
    },
    getMode(): ReviewReadingMode {
      return mode;
    },
    getNavigationTargetEntryKey(): string | null {
      return navigationTargetEntryKey;
    },
    getPinnedPrefixEntryKeys(): readonly string[] {
      return pinnedPrefixEntryKeys;
    },
    getSnapshot(): GitReviewReadingSessionSnapshot {
      return {
        mode,
        navigationTargetEntryKey,
        pinnedPrefixEntryKeys,
        selectedEntryKey,
        viewportEntryKeys,
      };
    },
    noteUserScroll(): void {
      // 导航中用户滚：清导航目标但仍保护 pin（交由调用方 clear nav）
      if (mode === "navigating") {
        navigationTargetEntryKey = null;
      }
      mode = "userScrolling";
      clearScrollIdleTimer();
      scrollIdleTimer = setTimeout(() => {
        scrollIdleTimer = null;
        if (mode === "userScrolling") {
          mode = "idle";
        }
      }, scrollIdleMs);
    },
    setSelectedEntryKey(entryKey: string | null): void {
      selectedEntryKey = entryKey;
    },
    syncPinnedPrefix(options: {
      readonly candidates: ReadonlySet<string>;
      readonly entryKeysInOrder: readonly string[];
      readonly selectedEntryKey: string | null;
      readonly viewportEntryKeys: readonly string[];
    }): readonly string[] {
      selectedEntryKey = options.selectedEntryKey;
      viewportEntryKeys = options.viewportEntryKeys;
      return recomputePin(options.candidates, options.entryKeysInOrder);
    },
  };
}
