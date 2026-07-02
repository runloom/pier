import type { QuickPickItem } from "./types.ts";

/** tier: 0 完全匹配 / 1 前缀 / 2 子串 / 3 散字母子序列。 */
interface QuickPickRank {
  readonly matchIndex: number;
  readonly tier: number;
}

interface RankedQuickPickItem {
  readonly item: QuickPickItem;
  readonly rank: QuickPickRank;
  readonly sourceIndex: number;
}

export function quickPickResults(
  items: readonly QuickPickItem[],
  query: string,
  sectionHeading?: string
): readonly QuickPickItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return items;
  }
  const ranked: RankedQuickPickItem[] = [];
  for (let sourceIndex = 0; sourceIndex < items.length; sourceIndex += 1) {
    const item = items[sourceIndex];
    if (!item) {
      continue;
    }
    const rank = quickPickItemRank(item, normalizedQuery, sectionHeading);
    if (rank) {
      ranked.push({ item, rank, sourceIndex });
    }
  }
  return ranked.sort(compareRankedItems).map((entry) => entry.item);
}

function quickPickItemRank(
  item: QuickPickItem,
  normalizedQuery: string,
  sectionHeading?: string
): QuickPickRank | null {
  let best: QuickPickRank | null = null;
  const values = [
    item.label,
    item.description,
    item.detail,
    item.id,
    ...(item.aliases ?? []),
    ...(item.searchTerms ?? []),
    ...(sectionHeading ? [sectionHeading] : []),
  ];
  for (const value of values) {
    const rank = textRank(value ?? "", normalizedQuery);
    if (rank && (!best || compareRanks(rank, best) < 0)) {
      best = rank;
    }
  }
  return best;
}

function textRank(
  value: string,
  normalizedQuery: string
): QuickPickRank | null {
  const text = value.toLocaleLowerCase();
  if (text === normalizedQuery) {
    return { matchIndex: 0, tier: 0 };
  }
  if (text.startsWith(normalizedQuery)) {
    return { matchIndex: 0, tier: 1 };
  }
  const matchIndex = text.indexOf(normalizedQuery);
  if (matchIndex >= 0) {
    return { matchIndex, tier: 2 };
  }
  const subsequenceIndex = fuzzySubsequenceIndex(text, normalizedQuery);
  if (subsequenceIndex >= 0) {
    return { matchIndex: subsequenceIndex, tier: 3 };
  }
  return null;
}

function fuzzySubsequenceIndex(text: string, normalizedQuery: string): number {
  let queryIndex = 0;
  let firstMatchIndex = -1;
  for (
    let textIndex = 0;
    textIndex < text.length && queryIndex < normalizedQuery.length;
    textIndex += 1
  ) {
    if (text[textIndex] === normalizedQuery[queryIndex]) {
      if (queryIndex === 0) {
        firstMatchIndex = textIndex;
      }
      queryIndex += 1;
    }
  }
  return queryIndex === normalizedQuery.length ? firstMatchIndex : -1;
}

function compareRanks(a: QuickPickRank, b: QuickPickRank): number {
  if (a.tier !== b.tier) {
    return a.tier - b.tier;
  }
  return a.matchIndex - b.matchIndex;
}

function compareRankedItems(
  a: RankedQuickPickItem,
  b: RankedQuickPickItem
): number {
  const byRank = compareRanks(a.rank, b.rank);
  if (byRank !== 0) {
    return byRank;
  }
  return a.sourceIndex - b.sourceIndex;
}
