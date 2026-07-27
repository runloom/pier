export interface SearchDocument<TPayload = unknown> {
  aliases: readonly string[];
  category: string;
  disabled: boolean;
  id: string;
  kind: "action" | "quick-pick";
  payload: TPayload;
  shortcutLabel?: string;
  source: string;
  stableId: string;
  title: string;
}

export interface SearchRank {
  frecency: number;
  fuzzyOrder: number;
  matchIndex: number;
  /**
   * Length of the visible field (title / alias / category text) that produced
   * this rank. Shorter fields are tighter matches when tier + matchIndex tie
   * (e.g. alias `git merge` beats `git merge abort` for query `gitm`).
   * Infinity when the rank did not come from a visible-text field.
   */
  matchLength: number;
  tier: number;
}

export interface SearchResult<TPayload = unknown> {
  document: SearchDocument<TPayload>;
  rank: SearchRank;
}
