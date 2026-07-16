export interface ReviewDocumentDemand {
  readonly bufferedEntryKeys: readonly string[];
  readonly visibleEntryKeys: readonly string[];
}

/** DiffsHub 风格首批读取下限：无 window 时也要先灌一批。 */
export const GIT_REVIEW_SEED_BATCH_MIN = 25;
/** 大仓首批上限，避免打开 Review 时全量扫读。 */
export const GIT_REVIEW_SEED_BATCH_MAX = 96;
/** 已 materialize 尾部后向预取的有界条数。 */
export const GIT_REVIEW_LOOKAHEAD = 2;

const DEFAULT_VIEWPORT_HEIGHT_PX = 800;
const DEFAULT_ITEM_HEIGHT_PX = 40;

export function prioritizeReviewNavigationDemand(
  demand: ReviewDocumentDemand,
  selectedEntryKey: string | null,
  navigationPending: boolean
): ReviewDocumentDemand {
  if (!(navigationPending && selectedEntryKey)) {
    return demand;
  }
  // 导航事务必须强制读取所选文件。目标可能仍不在 Pierre 当前窗口里；
  // 若只保留“已经可见/缓冲”的交集，窗口外点击会永远停在轻量占位槽。
  return {
    bufferedEntryKeys: [],
    visibleEntryKeys: [selectedEntryKey],
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
 * 首批 seed：按视口估算条数，夹在 [25, 96]。无 Pierre window 时也是合法首 demand。
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
  const itemHeightPx = options?.itemHeightPx ?? DEFAULT_ITEM_HEIGHT_PX;
  const estimated = Math.ceil(viewportHeightPx / itemHeightPx);
  const count = Math.min(
    GIT_REVIEW_SEED_BATCH_MAX,
    Math.max(GIT_REVIEW_SEED_BATCH_MIN, estimated),
    entryKeysInOrder.length
  );
  return entryKeysInOrder.slice(0, count);
}

/**
 * 在 demand∩prefetch 的最大下标之后，只取紧邻的 lookahead 个槽位中尚未 prefetch 的 entry。
 * 不跨过已覆盖槽位向远方扫描，避免有界 look-ahead 退化成全表 drain。
 * prefetch 集合只服务 demand，不表示 CodeView 成员。
 */
export function gitReviewLookaheadEntryKeys(
  entryKeysInOrder: readonly string[],
  demandPrefetchEntryKeys: ReadonlySet<string>,
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
  let maxIndex = -1;
  for (const [index, entryKey] of entryKeysInOrder.entries()) {
    if (demanded.has(entryKey) && demandPrefetchEntryKeys.has(entryKey)) {
      maxIndex = index;
    }
  }
  if (maxIndex < 0) {
    return [];
  }
  // 只看紧邻的 lookahead 个槽位，不跳过已覆盖项继续向远方 drain。
  const result: string[] = [];
  for (let offset = 1; offset <= lookahead; offset += 1) {
    const entryKey = entryKeysInOrder[maxIndex + offset];
    if (entryKey === undefined) {
      break;
    }
    if (!demandPrefetchEntryKeys.has(entryKey)) {
      result.push(entryKey);
    }
  }
  return result;
}

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
 * 组合顺序固定：seed ∪ window ∪ lookahead，再经导航排他。
 * nav pending 时 final 只有 selected。
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
}): ReviewDocumentDemand {
  // lookahead 只跟 Pierre 窗口走，不跟 seed 连锁，避免预取覆盖无限 drain。
  const lookaheadKeys = gitReviewLookaheadEntryKeys(
    options.entryKeysInOrder,
    options.demandPrefetchEntryKeys,
    options.windowDemand,
    options.lookahead
  );
  const base = mergeReviewDocumentDemand(
    { visibleEntryKeys: options.seedEntryKeys, bufferedEntryKeys: [] },
    options.windowDemand,
    { visibleEntryKeys: [], bufferedEntryKeys: lookaheadKeys }
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
