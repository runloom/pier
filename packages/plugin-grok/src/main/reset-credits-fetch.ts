import type { AccountUsageMetric } from "@pier/plugin-api/account-usage";
import type {
  DocumentOriginFetchRequest,
  DocumentOriginFetchResult,
} from "@pier/plugin-api/main";
import type {
  FetchImpl,
  RemainingResetsOriginFetch,
} from "./grok-usage-types.ts";
import {
  GROK_REMAINING_RESETS_REQUEST_BODY,
  GROK_REMAINING_RESETS_URL,
  parseGrokRemainingResetsRpcResult,
} from "./reset-credits.ts";
import {
  createTimeoutSignal,
  mergeAbortSignals,
} from "./usage-fetch-timeouts.ts";

const CLI_USER_AGENT = "grok-cli/1.0.0";
const REMAINING_RESETS_HOP_TIMEOUT_MS = 8000;
const REMAINING_RESETS_ORIGIN = "https://grok.com/";

function remainingResetsHeaders(
  sessionKey: string,
  userId: string | null | undefined,
  extra?: Record<string, string>
): Record<string, string> {
  return {
    Accept: "application/grpc-web+proto",
    Authorization: `Bearer ${sessionKey}`,
    "Content-Type": "application/grpc-web+proto",
    "x-grpc-web": "1",
    "x-grok-client-mode": "cli",
    "x-xai-token-auth": "xai-grok-cli",
    ...(userId ? { "x-userid": userId } : {}),
    ...extra,
  };
}

export function createRemainingResetsOriginFetch(
  documentOriginFetch: (
    request: DocumentOriginFetchRequest
  ) => Promise<DocumentOriginFetchResult>
): RemainingResetsOriginFetch {
  return async (request) => {
    try {
      const result = await documentOriginFetch({
        body: GROK_REMAINING_RESETS_REQUEST_BODY,
        headers: remainingResetsHeaders(request.sessionKey, request.userId),
        method: "POST",
        origin: REMAINING_RESETS_ORIGIN,
        signal: mergeAbortSignals([
          request.signal,
          createTimeoutSignal(REMAINING_RESETS_HOP_TIMEOUT_MS),
        ]),
        url: GROK_REMAINING_RESETS_URL,
      });
      if (!result.ok) return [];
      return parseGrokRemainingResetsRpcResult(result.body).metrics;
    } catch {
      return [];
    }
  };
}

async function metricsFromHttpResponse(response: {
  arrayBuffer?: () => Promise<ArrayBuffer>;
  ok: boolean;
  text(): Promise<string>;
}): Promise<AccountUsageMetric[] | undefined> {
  if (!response.ok) return;
  if (typeof response.arrayBuffer === "function") {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 0) {
      const parsed = parseGrokRemainingResetsRpcResult(bytes);
      return parsed.valid ? parsed.metrics : undefined;
    }
  }
  const parsed = parseGrokRemainingResetsRpcResult(await response.text());
  return parsed.valid ? parsed.metrics : undefined;
}

export async function fetchGrokRemainingResetsSoft(options: {
  fetchImpl: FetchImpl;
  originFetch?: RemainingResetsOriginFetch;
  sessionKey: string;
  signal: AbortSignal;
  userId?: string | null;
}): Promise<AccountUsageMetric[]> {
  const request = {
    sessionKey: options.sessionKey,
    signal: options.signal,
    ...(options.userId ? { userId: options.userId } : {}),
  };
  try {
    const response = await options.fetchImpl(GROK_REMAINING_RESETS_URL, {
      body: GROK_REMAINING_RESETS_REQUEST_BODY,
      headers: remainingResetsHeaders(options.sessionKey, options.userId, {
        Origin: "https://grok.com",
        Referer: "https://grok.com/",
        "User-Agent": CLI_USER_AGENT,
      }),
      method: "POST",
      signal: mergeAbortSignals([
        options.signal,
        createTimeoutSignal(REMAINING_RESETS_HOP_TIMEOUT_MS),
      ]),
    });
    if (!options.signal.aborted) {
      const metrics = await metricsFromHttpResponse(response);
      if (metrics) return metrics;
    }
  } catch {
    // Cloudflare HTML / transport: fall through to grok.com origin fetch.
  }
  if (options.signal.aborted || !options.originFetch) {
    return [];
  }
  try {
    return await options.originFetch(request);
  } catch {
    return [];
  }
}
