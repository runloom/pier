import type { Action } from "@/lib/actions/types.ts";
import { rankSearchDocuments } from "./ranker.ts";
import type { SearchDocument, SearchResult } from "./types.ts";

interface BuildActionSearchDocumentOptions {
  categoryLabel?: string;
  disabled?: boolean;
  shortcutLabel?: string;
  source?: string;
}

interface RankActionSearchDocumentsOptions {
  frecencyMap?: ReadonlyMap<string, number>;
}

export function buildActionSearchDocument(
  action: Action,
  options: BuildActionSearchDocumentOptions = {}
): SearchDocument<Action> {
  const aliases = uniqueStrings([
    ...(action.metadata?.aliases?.() ?? []),
    ...(action.metadata?.keywords ?? []),
  ]);

  return {
    aliases,
    category: options.categoryLabel ?? action.category,
    disabled: options.disabled ?? action.enabled?.() === false,
    id: action.id,
    kind: "action",
    payload: action,
    ...(options.shortcutLabel ? { shortcutLabel: options.shortcutLabel } : {}),
    source: options.source ?? "action-registry",
    stableId: action.id,
    title: action.title(),
  };
}

export function rankActionSearchDocuments(
  documents: readonly SearchDocument<Action>[],
  query: string,
  options: RankActionSearchDocumentsOptions = {}
): SearchResult<Action>[] {
  return rankSearchDocuments(documents, query, options);
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
