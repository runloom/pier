import type { AccountUsageMetric } from "@pier/plugin-api/account-usage";

export type FetchImpl = (
  input: string,
  init?: {
    body?: string | Uint8Array | undefined;
    headers?: Record<string, string> | undefined;
    method?: string | undefined;
    signal?: AbortSignal | undefined;
  }
) => Promise<{
  arrayBuffer?: () => Promise<ArrayBuffer>;
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export type RemainingResetsOriginFetch = (request: {
  sessionKey: string;
  signal: AbortSignal;
  userId?: string | null;
}) => Promise<AccountUsageMetric[]>;

export function originFetchOption(
  remainingResetsOriginFetch: RemainingResetsOriginFetch | undefined
): { remainingResetsOriginFetch?: RemainingResetsOriginFetch } {
  return remainingResetsOriginFetch ? { remainingResetsOriginFetch } : {};
}

export function resolveFetchImpl(fetchImpl?: FetchImpl): FetchImpl {
  return fetchImpl ?? (globalThis.fetch as unknown as FetchImpl);
}
