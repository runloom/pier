import {
  isReadingProtectedMode,
  type ReviewReadingMode,
} from "./git-review-reading-session.ts";

export interface ReviewDocumentDemand {
  readonly bufferedEntryKeys: readonly string[];
  readonly visibleEntryKeys: readonly string[];
}

/**
 * 首批 seed 下限：只够首屏 + 一点缓冲。
 * 过大（旧 25）会在 estimate→loaded 时连环撑高，冷启动抖。
 */
export const GIT_REVIEW_SEED_BATCH_MIN = 6;
/** 大仓首批上限；有 Pierre window 后以 window demand 为主，seed 退出主导。 */
export const GIT_REVIEW_SEED_BATCH_MAX = 24;
/**
 * 视口两侧（前/后）各预取的有界条数。
 * 只锚在 window demand 上，禁止 seed 连锁 drain。
 */
export const GIT_REVIEW_LOOKAHEAD = 4;
/**
 * 树选中项两侧邻域预取（导航未 pending 时）。
 * 改善「点到再等」；有界，不替代 window。
 */
export const GIT_REVIEW_SELECTION_RADIUS = 2;
/**
 * 全量正文水合优先级选择上限（非显示账本 id cap）。
 * stable-ledger 显示集 = 全 index；此上限只约束「优先灌 loaded body」的候选序。
 * pin（selected/visible/buffered demand）可短暂超过；其余按优先级截断。
 */
export const GIT_REVIEW_MAX_FULL_BODY_ENTRIES = 128;
/** @deprecated Use {@link GIT_REVIEW_MAX_FULL_BODY_ENTRIES}. */
export const GIT_REVIEW_MAX_CODEVIEW_MEMBERS = GIT_REVIEW_MAX_FULL_BODY_ENTRIES;

/** 成员策略用的导航原因：树点击 vs 代际 rebind。 */
export type ReviewNavigationMemberReason = "tree" | "rebind";

const DEFAULT_VIEWPORT_HEIGHT_PX = 800;
/**
 * 与 `PIER_DIFF_ESTIMATE_SLOT_HEIGHT_PX` 对齐：按「骨架槽」估可见条数，
 * 而不是按 40px 假高度算出 20+ 个文件同时进 demand。
 */
const DEFAULT_ITEM_HEIGHT_PX = 360;

/**
 * 导航时 boost selected 到 visible 队首，**保留** window/lookahead。
 * 禁止 replace 为「仅 selected」（full-alignment K3）。
 */
export function prioritizeReviewNavigationDemand(
  demand: ReviewDocumentDemand,
  selectedEntryKey: string | null,
  navigationPending: boolean
): ReviewDocumentDemand {
  if (!(navigationPending && selectedEntryKey)) {
    return demand;
  }
  const withoutSelectedBuffered = demand.bufferedEntryKeys.filter(
    (entryKey) => entryKey !== selectedEntryKey
  );
  if (demand.visibleEntryKeys[0] === selectedEntryKey) {
    return {
      bufferedEntryKeys: withoutSelectedBuffered,
      visibleEntryKeys: demand.visibleEntryKeys,
    };
  }
  const restVisible = demand.visibleEntryKeys.filter(
    (entryKey) => entryKey !== selectedEntryKey
  );
  return {
    bufferedEntryKeys: withoutSelectedBuffered,
    visibleEntryKeys: [selectedEntryKey, ...restVisible],
  };
}

/**
 * Pierre 是窗口边界的唯一所有者。renderer 只把官方返回的 item id 精确映射
 * 为 entryKey，不再在官方缓冲区之外猜测相邻条目。
 */
export function reviewDocumentDemandForRenderWindow(
  entryKeyBySectionId: ReadonlyMap<string, string>,
  validEntryKeys: ReadonlySet<string>,
  window: {
    readonly bufferedItemIds: readonly string[];
    readonly visibleItemIds: readonly string[];
  }
): ReviewDocumentDemand {
  const visibleEntryKeys = mapUniqueEntryKeys(
    window.visibleItemIds,
    entryKeyBySectionId,
    validEntryKeys
  );
  const visible = new Set(visibleEntryKeys);
  const bufferedEntryKeys = mapUniqueEntryKeys(
    window.bufferedItemIds,
    entryKeyBySectionId,
    validEntryKeys
  ).filter((entryKey) => !visible.has(entryKey));
  return { bufferedEntryKeys, visibleEntryKeys };
}

/**
 * 首批 seed：按「estimate 槽高」估算可见条数，夹在 [MIN, MAX]。
 * 无 Pierre window 时也是合法首 demand；有 window 后 seed 不再扩张主导。
 */
export function gitReviewSeedEntryKeys(
  entryKeysInOrder: readonly string[],
  options?: {
    readonly itemHeightPx?: number;
    readonly viewportHeightPx?: number;
  }
): string[] {
  const viewportHeightPx =
    options?.viewportHeightPx ?? DEFAULT_VIEWPORT_HEIGHT_PX;
  const itemHeightPx = Math.max(
    1,
    options?.itemHeightPx ?? DEFAULT_ITEM_HEIGHT_PX
  );
  // 视口可容纳 + 1 缓冲，再夹到 [MIN, MAX]
  const estimated = Math.ceil(viewportHeightPx / itemHeightPx) + 1;
  const count = Math.min(
    GIT_REVIEW_SEED_BATCH_MAX,
    Math.max(GIT_REVIEW_SEED_BATCH_MIN, estimated),
    entryKeysInOrder.length
  );
  return entryKeysInOrder.slice(0, count);
}

/**
 * 在 window demand 的 [min,max] 下标两侧，各取 lookahead 个不在 demand 内的槽位。
 */
export function gitReviewLookaheadEntryKeys(
  entryKeysInOrder: readonly string[],
  _demandPrefetchEntryKeys: ReadonlySet<string>,
  demand: ReviewDocumentDemand,
  lookahead: number = GIT_REVIEW_LOOKAHEAD
): string[] {
  if (lookahead <= 0 || entryKeysInOrder.length === 0) {
    return [];
  }
  const demanded = new Set([
    ...demand.visibleEntryKeys,
    ...demand.bufferedEntryKeys,
  ]);
  if (demanded.size === 0) {
    return [];
  }
  let minIndex = Number.POSITIVE_INFINITY;
  let maxIndex = -1;
  for (const [index, entryKey] of entryKeysInOrder.entries()) {
    if (demanded.has(entryKey)) {
      minIndex = Math.min(minIndex, index);
      maxIndex = Math.max(maxIndex, index);
    }
  }
  if (maxIndex < 0 || !Number.isFinite(minIndex)) {
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (let offset = 1; offset <= lookahead; offset += 1) {
    const after = entryKeysInOrder[maxIndex + offset];
    if (after !== undefined && !demanded.has(after) && !seen.has(after)) {
      seen.add(after);
      result.push(after);
    }
    const before = entryKeysInOrder[minIndex - offset];
    if (before !== undefined && !demanded.has(before) && !seen.has(before)) {
      seen.add(before);
      result.push(before);
    }
  }
  return result;
}

/**
 * 选中项两侧邻域（不含自身）。
 */
export function gitReviewSelectionRadiusEntryKeys(
  entryKeysInOrder: readonly string[],
  selectedEntryKey: string | null,
  radius: number = GIT_REVIEW_SELECTION_RADIUS
): string[] {
  if (selectedEntryKey === null || radius <= 0) {
    return [];
  }
  const index = entryKeysInOrder.indexOf(selectedEntryKey);
  if (index < 0) {
    return [];
  }
  const result: string[] = [];
  for (let offset = 1; offset <= radius; offset += 1) {
    const before = entryKeysInOrder[index - offset];
    if (before !== undefined) {
      result.push(before);
    }
    const after = entryKeysInOrder[index + offset];
    if (after !== undefined) {
      result.push(after);
    }
  }
  return result;
}

/**
 * 正文水合优先级选择（非显示账本成员集）。
 * 显示几何由 projectReviewLedger 全 index 负责；本函数只排「优先 load body」序。
 * - 输出 **index 序**，禁止 pin-first 重排
 * - 阅读保护：pinnedPrefix ∪ demand pin ∪ sticky 不可因 cap 删除；可暂超 max
 * - idle：sticky 仅 fill 优先级，可裁回 cap
 */
export function selectBodyHydrationPriorityEntryKeys(options: {
  readonly candidateEntryKeys: readonly string[];
  readonly demand: ReviewDocumentDemand;
  readonly entryKeysInOrder: readonly string[];
  readonly maxMembers?: number;
  readonly navigationPending?: boolean;
  readonly navigationReason?: ReviewNavigationMemberReason | null;
  /** 阅读会话 pin 前缀（视口∪选中∪导航目标）；保护期内不可裁 */
  readonly pinnedPrefixEntryKeys?: readonly string[];
  readonly previousMemberEntryKeys?: readonly string[];
  /** 默认：nav pending 时 protected，否则 idle */
  readonly readingMode?: ReviewReadingMode;
  readonly selectedEntryKey: string | null;
}): string[] {
  const maxMembers = options.maxMembers ?? GIT_REVIEW_MAX_FULL_BODY_ENTRIES;
  const candidate = new Set(options.candidateEntryKeys);
  const demandPin = new Set<string>();
  const addDemandPin = (entryKey: string | null | undefined): void => {
    if (
      entryKey !== null &&
      entryKey !== undefined &&
      candidate.has(entryKey)
    ) {
      demandPin.add(entryKey);
    }
  };
  addDemandPin(options.selectedEntryKey);
  for (const entryKey of options.demand.visibleEntryKeys) {
    addDemandPin(entryKey);
  }
  for (const entryKey of options.demand.bufferedEntryKeys) {
    addDemandPin(entryKey);
  }

  const pending = options.navigationPending === true;
  const reason =
    options.navigationReason ?? (pending ? ("tree" as const) : null);
  const readingMode: ReviewReadingMode =
    options.readingMode ??
    (pending && (reason === "tree" || reason === "rebind")
      ? "navigating"
      : "idle");
  const readingProtected = isReadingProtectedMode(readingMode);

  // 阅读 pin：显式 prefix ∪（保护期内 previous 中仍 candidate 的 sticky）
  const readingPin = new Set<string>();
  for (const entryKey of options.pinnedPrefixEntryKeys ?? []) {
    if (candidate.has(entryKey)) {
      readingPin.add(entryKey);
    }
  }

  const sticky = new Set<string>();
  for (const entryKey of options.previousMemberEntryKeys ?? []) {
    if (
      candidate.has(entryKey) &&
      !demandPin.has(entryKey) &&
      !readingPin.has(entryKey)
    ) {
      sticky.add(entryKey);
    }
  }

  const fill: string[] = [];
  for (const entryKey of options.entryKeysInOrder) {
    if (
      candidate.has(entryKey) &&
      !demandPin.has(entryKey) &&
      !readingPin.has(entryKey) &&
      !sticky.has(entryKey)
    ) {
      fill.push(entryKey);
    }
  }

  const stickyOrdered = options.entryKeysInOrder.filter((entryKey) =>
    sticky.has(entryKey)
  );
  const selected = new Set<string>();

  if (
    readingProtected ||
    (pending && (reason === "tree" || reason === "rebind"))
  ) {
    // 阅读/导航保护：demand pin + reading pin + sticky 全保留，可暂超 cap。
    // **禁止 fill**：避免点树/滚动中邻文件 load 插队改拓扑 → 高度抖、定位漂。
    for (const entryKey of demandPin) {
      selected.add(entryKey);
    }
    for (const entryKey of readingPin) {
      selected.add(entryKey);
    }
    for (const entryKey of sticky) {
      selected.add(entryKey);
    }
  } else {
    // idle：demand pin 不可裁；sticky 作 fill 优先级
    for (const entryKey of demandPin) {
      selected.add(entryKey);
    }
    for (const entryKey of readingPin) {
      selected.add(entryKey);
    }
    const orderedFill = [...stickyOrdered, ...fill];
    const mandatorySize = selected.size;
    const budget = Math.max(0, maxMembers - mandatorySize);
    for (const entryKey of orderedFill.slice(0, budget)) {
      selected.add(entryKey);
    }
  }

  return options.entryKeysInOrder.filter((entryKey) => selected.has(entryKey));
}

/**
 * @deprecated Use {@link selectBodyHydrationPriorityEntryKeys}.
 * 名称误导为「CodeView 显示成员」；stable-ledger 显示集不经此函数。
 */
export const selectCodeViewMemberEntryKeys =
  selectBodyHydrationPriorityEntryKeys;

/** 按 parts 顺序合并 visible/buffered，去重，buffered 剔除已在 visible 中的。 */
export function mergeReviewDocumentDemand(
  ...parts: readonly ReviewDocumentDemand[]
): ReviewDocumentDemand {
  const visibleEntryKeys: string[] = [];
  const visible = new Set<string>();
  for (const part of parts) {
    for (const entryKey of part.visibleEntryKeys) {
      if (visible.has(entryKey)) {
        continue;
      }
      visible.add(entryKey);
      visibleEntryKeys.push(entryKey);
    }
  }
  const bufferedEntryKeys: string[] = [];
  const buffered = new Set<string>();
  for (const part of parts) {
    for (const entryKey of part.bufferedEntryKeys) {
      if (visible.has(entryKey) || buffered.has(entryKey)) {
        continue;
      }
      buffered.add(entryKey);
      bufferedEntryKeys.push(entryKey);
    }
  }
  return { bufferedEntryKeys, visibleEntryKeys };
}

/**
 * 组合 demand（只调度读）：
 * - 无 window window：seed
 * - 有 window：seed 退出
 * - window ∪ 双向 lookahead ∪ 选中邻域
 * - nav：boost selected，**保留** window（非仅 selected）
 */
export function composeReviewDocumentDemand(options: {
  readonly entryKeysInOrder: readonly string[];
  readonly navigationPending: boolean;
  readonly selectedEntryKey: string | null;
  readonly seedEntryKeys: readonly string[];
  /** demand 预取覆盖（非 CodeView 成员）。 */
  readonly demandPrefetchEntryKeys: ReadonlySet<string>;
  readonly windowDemand: ReviewDocumentDemand;
  readonly lookahead?: number;
  readonly selectionRadius?: number;
}): ReviewDocumentDemand {
  const windowActive = options.windowDemand.visibleEntryKeys.length > 0;
  const seedEntryKeys = windowActive ? [] : options.seedEntryKeys;
  const lookaheadKeys = gitReviewLookaheadEntryKeys(
    options.entryKeysInOrder,
    options.demandPrefetchEntryKeys,
    options.windowDemand,
    options.lookahead
  );
  // nav 时仍保留 window；邻域由 boost selected 覆盖，避免与 exclusive 混用
  const selectionRadiusKeys =
    options.navigationPending || options.selectedEntryKey === null
      ? []
      : gitReviewSelectionRadiusEntryKeys(
          options.entryKeysInOrder,
          options.selectedEntryKey,
          options.selectionRadius
        );
  const base = mergeReviewDocumentDemand(
    { visibleEntryKeys: seedEntryKeys, bufferedEntryKeys: [] },
    options.windowDemand,
    { visibleEntryKeys: [], bufferedEntryKeys: lookaheadKeys },
    { visibleEntryKeys: [], bufferedEntryKeys: selectionRadiusKeys }
  );
  return prioritizeReviewNavigationDemand(
    base,
    options.selectedEntryKey,
    options.navigationPending
  );
}

function mapUniqueEntryKeys(
  itemIds: readonly string[],
  entryKeyBySectionId: ReadonlyMap<string, string>,
  validEntryKeys: ReadonlySet<string>
): string[] {
  const seen = new Set<string>();
  const entryKeys: string[] = [];
  for (const itemId of itemIds) {
    const entryKey = entryKeyBySectionId.get(itemId);
    if (
      entryKey === undefined ||
      !validEntryKeys.has(entryKey) ||
      seen.has(entryKey)
    ) {
      continue;
    }
    seen.add(entryKey);
    entryKeys.push(entryKey);
  }
  return entryKeys;
}
