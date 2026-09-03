import { rankSearchDocuments } from "@/lib/search/ranker.ts";
import type { SearchDocument } from "@/lib/search/types.ts";
import type { ComposerSkillSuggestItem } from "./composer-skill-suggest.ts";

export function buildComposerSkillSearchDocument(
  item: ComposerSkillSuggestItem
): SearchDocument<ComposerSkillSuggestItem> {
  return {
    aliases: uniqueStrings([item.id, item.invokeText, item.description]),
    category: item.source,
    disabled: false,
    id: item.invokeText || item.id,
    kind: "suggest",
    payload: item,
    source: item.source,
    stableId: item.invokeText || item.id,
    title: item.label,
  };
}

export function filterComposerSkillSuggestItems(
  items: readonly ComposerSkillSuggestItem[],
  query: string
): ComposerSkillSuggestItem[] {
  if (query.trim().length === 0) {
    return [...items];
  }
  return rankSearchDocuments(
    items.map(buildComposerSkillSearchDocument),
    query
  ).map((result) => result.document.payload);
}

function uniqueStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
