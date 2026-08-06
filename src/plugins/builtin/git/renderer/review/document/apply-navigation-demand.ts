import {
  prioritizeReviewNavigationDemand,
  type ReviewDocumentDemand,
} from "./demand.ts";

type ReviewDemandLoader = {
  getResource(entryKey: string): unknown;
  setProtectedEntryKey(entryKey: string | null): void;
  setWindowDemand(demand: ReviewDocumentDemand): void;
} | null;

/**
 * full-alignment：boost selected，保留 window/seed（禁止 pin-only exclusive replace）。
 * 选中项若已不在本面（全量 stage 走光），只收敛 window，勿 pin 幽灵 key。
 */
export function applyReviewNavigationDemand(options: {
  readonly currentDemand: ReviewDocumentDemand;
  readonly entryKey: string;
  readonly loader: ReviewDemandLoader;
  readonly seedEntryKeys: readonly string[];
}): ReviewDocumentDemand {
  const { currentDemand, entryKey, loader, seedEntryKeys } = options;
  const known = (keys: readonly string[]): string[] =>
    loader
      ? keys.filter((key) => loader.getResource(key) !== undefined)
      : [...keys];
  const filteredCurrent = {
    bufferedEntryKeys: known(currentDemand.bufferedEntryKeys),
    visibleEntryKeys: known(currentDemand.visibleEntryKeys),
  };
  const hasWindow =
    filteredCurrent.visibleEntryKeys.length > 0 ||
    filteredCurrent.bufferedEntryKeys.length > 0;
  const seedKnown = known(seedEntryKeys);
  const entryKnown =
    loader === null || loader.getResource(entryKey) !== undefined;
  let seedVisibleEntryKeys: readonly string[] = [];
  if (seedKnown.length > 0) {
    seedVisibleEntryKeys = seedKnown;
  } else if (entryKnown) {
    seedVisibleEntryKeys = [entryKey];
  }
  const base = hasWindow
    ? filteredCurrent
    : {
        bufferedEntryKeys: [] as const,
        visibleEntryKeys: seedVisibleEntryKeys,
      };
  const demand = entryKnown
    ? prioritizeReviewNavigationDemand(base, entryKey, true)
    : base;
  loader?.setWindowDemand(demand);
  loader?.setProtectedEntryKey(entryKnown ? entryKey : null);
  return demand;
}
