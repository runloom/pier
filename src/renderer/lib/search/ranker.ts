import uFuzzy from "@leeoniya/ufuzzy";
import type { SearchDocument, SearchRank, SearchResult } from "./types.ts";

const fuzzy = new uFuzzy({
  interLft: 0,
  interRgt: 0,
  unicode: true,
});
const SEARCH_SEPARATOR_RE = /[\s:：._/-]+/g;

interface RankSearchDocumentsOptions {
  frecencyMap?: ReadonlyMap<string, number>;
}

interface RankedCandidate<TPayload> {
  document: SearchDocument<TPayload>;
  rank: SearchRank;
  sourceIndex: number;
}

export function rankSearchDocuments<TPayload>(
  documents: readonly SearchDocument<TPayload>[],
  query: string,
  options: RankSearchDocumentsOptions = {}
): SearchResult<TPayload>[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return [];
  }

  const fuzzyOrder = buildFuzzyOrder(documents, normalizedQuery);
  const candidates: RankedCandidate<TPayload>[] = [];

  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    if (!document) {
      continue;
    }
    const rank = rankDocument(
      document,
      normalizedQuery,
      fuzzyOrder.get(index) ?? Number.POSITIVE_INFINITY,
      options.frecencyMap?.get(document.id) ?? 0
    );
    if (rank) {
      candidates.push({ document, rank, sourceIndex: index });
    }
  }

  return candidates.sort(compareRankedCandidates);
}

function buildFuzzyOrder<TPayload>(
  documents: readonly SearchDocument<TPayload>[],
  normalizedQuery: string
): ReadonlyMap<number, number> {
  const haystack = documents.map(searchableTextForFuzzy);
  const [, info, order] = fuzzy.search(haystack, normalizedQuery, 5);
  const result = new Map<number, number>();
  if (!(info && order)) {
    return result;
  }
  for (let rank = 0; rank < order.length; rank += 1) {
    const infoOrderIndex = order[rank];
    if (infoOrderIndex == null) {
      continue;
    }
    const documentIndex = info.idx[infoOrderIndex];
    if (documentIndex != null) {
      result.set(documentIndex, rank);
    }
  }
  return result;
}

/**
 * 次带（元数据）整体后移量。可见文本分两个强度带：
 * 主带 = title + aliases——命令本体的名字，tier 0-3；
 * 次带 = 「category title」组合、category、快捷键标签——元数据兜底，tier 4-7。
 * 不分带时，共享 category 的命令在单词类目查询（如 "git"）上会被 category
 * 精确命中拍平到同一 tier，排序退化成 frecency 说了算——常用的 worktree
 * 命令反而压过标题真正带 "Git: " 前缀的命令。
 */
const PRIMARY_TIER_MAX = 3;
const SECONDARY_TIER_OFFSET = PRIMARY_TIER_MAX + 1;

function rankDocument<TPayload>(
  document: SearchDocument<TPayload>,
  normalizedQuery: string,
  fuzzyOrder: number,
  frecency: number
): SearchRank | null {
  const primaryRank = bestVisibleTextRank(
    [document.title, ...document.aliases],
    normalizedQuery
  );
  if (primaryRank) {
    return {
      ...primaryRank,
      frecency,
      fuzzyOrder,
    };
  }
  const secondaryRank = bestVisibleTextRank(
    [
      `${document.category} ${document.title}`,
      document.category,
      document.shortcutLabel ?? "",
    ],
    normalizedQuery
  );
  if (secondaryRank) {
    return {
      frecency,
      fuzzyOrder,
      matchIndex: secondaryRank.matchIndex,
      tier: secondaryRank.tier + SECONDARY_TIER_OFFSET,
    };
  }

  if (Number.isFinite(fuzzyOrder)) {
    return {
      frecency,
      fuzzyOrder,
      matchIndex: 0,
      tier: 8,
    };
  }

  const stableId = normalize(document.stableId);
  if (stableId === normalizedQuery) {
    return {
      frecency,
      fuzzyOrder,
      matchIndex: 0,
      tier: 9,
    };
  }
  const stableIdIndex = stableId.indexOf(normalizedQuery);
  if (stableIdIndex >= 0) {
    return {
      frecency,
      fuzzyOrder,
      matchIndex: stableIdIndex,
      tier: 10,
    };
  }

  return null;
}

function bestVisibleTextRank(
  texts: readonly string[],
  normalizedQuery: string
): Pick<SearchRank, "matchIndex" | "tier"> | null {
  let best: Pick<SearchRank, "matchIndex" | "tier"> | null = null;
  for (const text of texts) {
    const normalizedText = normalize(text);
    if (!normalizedText) {
      continue;
    }
    const rank = visibleTextRank(normalizedText, normalizedQuery);
    if (!rank) {
      continue;
    }
    if (
      !best ||
      rank.tier < best.tier ||
      (rank.tier === best.tier && rank.matchIndex < best.matchIndex)
    ) {
      best = rank;
    }
  }
  return best;
}

function visibleTextRank(
  normalizedText: string,
  normalizedQuery: string
): Pick<SearchRank, "matchIndex" | "tier"> | null {
  if (normalizedText === normalizedQuery) {
    return { matchIndex: 0, tier: 0 };
  }
  if (normalizedText.startsWith(normalizedQuery)) {
    return { matchIndex: 0, tier: 1 };
  }
  const matchIndex = normalizedText.indexOf(normalizedQuery);
  if (matchIndex >= 0) {
    return { matchIndex, tier: 2 };
  }
  const compactRank = compactTextRank(normalizedText, normalizedQuery);
  if (compactRank) {
    return compactRank;
  }
  const initialsRank = initialsTextRank(normalizedText, normalizedQuery);
  if (initialsRank) {
    return initialsRank;
  }
  return null;
}

function compactTextRank(
  normalizedText: string,
  normalizedQuery: string
): Pick<SearchRank, "matchIndex" | "tier"> | null {
  const compactText = compact(normalizedText);
  const compactQuery = compact(normalizedQuery);
  if (!(compactText && compactQuery)) {
    return null;
  }
  if (compactText === compactQuery || compactText.startsWith(compactQuery)) {
    return { matchIndex: 0, tier: 3 };
  }
  const matchIndex = compactText.indexOf(compactQuery);
  return matchIndex >= 0 ? { matchIndex, tier: 3 } : null;
}

function initialsTextRank(
  normalizedText: string,
  normalizedQuery: string
): Pick<SearchRank, "matchIndex" | "tier"> | null {
  const initials = normalizedText
    .split(SEARCH_SEPARATOR_RE)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
  const compactQuery = compact(normalizedQuery);
  if (!(initials && compactQuery)) {
    return null;
  }
  if (initials === compactQuery || initials.startsWith(compactQuery)) {
    return { matchIndex: 0, tier: 3 };
  }
  const matchIndex = initials.indexOf(compactQuery);
  return matchIndex >= 0 ? { matchIndex, tier: 3 } : null;
}

function compareRankedCandidates<TPayload>(
  a: RankedCandidate<TPayload>,
  b: RankedCandidate<TPayload>
): number {
  if (a.rank.tier !== b.rank.tier) {
    return a.rank.tier - b.rank.tier;
  }
  if (a.rank.frecency !== b.rank.frecency) {
    return b.rank.frecency - a.rank.frecency;
  }
  if (a.rank.matchIndex !== b.rank.matchIndex) {
    return a.rank.matchIndex - b.rank.matchIndex;
  }
  if (a.rank.fuzzyOrder !== b.rank.fuzzyOrder) {
    return a.rank.fuzzyOrder - b.rank.fuzzyOrder;
  }
  return a.sourceIndex - b.sourceIndex;
}

function searchableTextForFuzzy<TPayload>(
  document: SearchDocument<TPayload>
): string {
  return normalize(
    [
      document.title,
      document.category,
      ...document.aliases,
      document.shortcutLabel ?? "",
    ].join(" ")
  );
}

function normalize(value: string): string {
  return uFuzzy.latinize(value).trim().toLowerCase();
}

function compact(value: string): string {
  return value.replace(SEARCH_SEPARATOR_RE, "");
}
