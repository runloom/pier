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

function rankDocument<TPayload>(
  document: SearchDocument<TPayload>,
  normalizedQuery: string,
  fuzzyOrder: number,
  frecency: number
): SearchRank | null {
  const visibleTexts = [
    `${document.category} ${document.title}`,
    document.title,
    ...document.aliases,
    document.category,
    document.shortcutLabel ?? "",
  ];
  const textRank = bestVisibleTextRank(visibleTexts, normalizedQuery);
  if (textRank) {
    return {
      ...textRank,
      frecency,
      fuzzyOrder,
    };
  }

  if (Number.isFinite(fuzzyOrder)) {
    return {
      frecency,
      fuzzyOrder,
      matchIndex: 0,
      tier: 4,
    };
  }

  const stableId = normalize(document.stableId);
  if (stableId === normalizedQuery) {
    return {
      frecency,
      fuzzyOrder,
      matchIndex: 0,
      tier: 5,
    };
  }
  const stableIdIndex = stableId.indexOf(normalizedQuery);
  if (stableIdIndex >= 0) {
    return {
      frecency,
      fuzzyOrder,
      matchIndex: stableIdIndex,
      tier: 6,
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
