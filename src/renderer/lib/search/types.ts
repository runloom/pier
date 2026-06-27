export interface SearchDocument<TPayload = unknown> {
  aliases: readonly string[];
  category: string;
  disabled: boolean;
  id: string;
  kind: "action";
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
  tier: number;
}

export interface SearchResult<TPayload = unknown> {
  document: SearchDocument<TPayload>;
  rank: SearchRank;
}
