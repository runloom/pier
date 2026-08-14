export type FetchImpl = (
  input: string,
  init?: {
    body?: ArrayBuffer | ArrayBufferView | string;
    headers?: Record<string, string>;
    method?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  arrayBuffer?: () => Promise<ArrayBuffer>;
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;
