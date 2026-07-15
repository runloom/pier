export type FetchImpl = (
  input: string,
  init?: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;
