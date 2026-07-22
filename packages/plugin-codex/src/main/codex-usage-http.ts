import {
  extractAccountIdFromAccessToken,
  parseCodexAuthJsonTokens,
} from "./token-refresh.ts";
import type { AccountUsageResult } from "./types.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const USAGE_TIMEOUT_MS = 15_000;

export type FetchImpl = typeof fetch;

interface WhamWindow {
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
  used_percent?: number;
}

interface WhamRateLimit {
  allowed?: boolean;
  limit_reached?: boolean;
  primary_window?: WhamWindow | null;
  secondary_window?: WhamWindow | null;
}

interface WhamUsageResponse {
  code_review_rate_limit?: WhamRateLimit | null;
  plan_type?: string;
  rate_limit?: WhamRateLimit | null;
}

function mapWhamWindow(
  raw: WhamWindow | null | undefined,
  position: "primary" | "secondary"
): AccountUsageResult["windows"][number] | undefined {
  if (
    !raw ||
    typeof raw.used_percent !== "number" ||
    !Number.isFinite(raw.used_percent)
  ) {
    return;
  }
  const result: AccountUsageResult["windows"][number] = {
    id: `codex:${position}`,
    limitId: "codex",
    usedPercent: raw.used_percent,
  };
  // reset_at is epoch seconds; reset_after_seconds is relative to now.
  if (typeof raw.reset_at === "number" && Number.isFinite(raw.reset_at)) {
    result.resetsAt = raw.reset_at * 1000;
  } else if (
    typeof raw.reset_after_seconds === "number" &&
    Number.isFinite(raw.reset_after_seconds) &&
    raw.reset_after_seconds >= 0
  ) {
    result.resetsAt = Date.now() + raw.reset_after_seconds * 1000;
  }
  if (
    typeof raw.limit_window_seconds === "number" &&
    Number.isFinite(raw.limit_window_seconds) &&
    raw.limit_window_seconds > 0
  ) {
    result.windowMinutes = Math.ceil(raw.limit_window_seconds / 60);
  }
  return result;
}

function mapWhamRateLimit(
  raw: WhamRateLimit | null | undefined
): AccountUsageResult["windows"] {
  if (!raw) return [];
  return [
    mapWhamWindow(raw.primary_window, "primary"),
    mapWhamWindow(raw.secondary_window, "secondary"),
  ]
    .filter(
      (window): window is AccountUsageResult["windows"][number] =>
        window !== undefined
    )
    .sort(
      (left, right) =>
        (left.windowMinutes ?? Number.POSITIVE_INFINITY) -
        (right.windowMinutes ?? Number.POSITIVE_INFINITY)
    );
}

export function parseWhamUsageResult(json: unknown): AccountUsageResult {
  if (typeof json !== "object" || json === null) {
    return { status: "error", error: "Invalid usage response", windows: [] };
  }
  const data = json as WhamUsageResponse;
  const out: AccountUsageResult = { status: "ok", windows: [] };
  if (typeof data.plan_type === "string" && data.plan_type.length > 0) {
    out.planType = data.plan_type;
  }
  const windows = mapWhamRateLimit(data.rate_limit);
  if (data.code_review_rate_limit) {
    const codeReviewWindows = mapWhamRateLimit(data.code_review_rate_limit);
    for (const window of codeReviewWindows) {
      window.limitId = "codex:code_review";
      window.id = `codex:code_review:${window.id.split(":").at(-1)}`;
    }
    out.windows = [...windows, ...codeReviewWindows];
  } else {
    out.windows = windows;
  }
  return out;
}

/**
 * Fetch Codex usage via the HTTP wham/usage endpoint instead of spawning
 * a `codex app-server` child process. Requires the managed auth.json content
 * to extract the access_token and account_id.
 *
 * Mirrors cockpit-tools' `fetch_quota`:
 * GET https://chatgpt.com/backend-api/wham/usage
 * Headers: Authorization: Bearer <access_token>, ChatGPT-Account-Id: <account_id>
 */
export async function fetchCodexUsageHttp(
  authJsonContent: string,
  options: {
    fetchImpl?: FetchImpl;
    signal: AbortSignal;
  }
): Promise<AccountUsageResult> {
  const parsed = parseCodexAuthJsonTokens(authJsonContent);
  if (!parsed) {
    return {
      status: "error",
      error: "Invalid auth.json for usage fetch",
      windows: [],
    };
  }

  const accessToken = parsed.tokens.access_token;
  const accountId =
    parsed.tokens.account_id ||
    extractAccountIdFromAccessToken(accessToken) ||
    "";

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (options.signal.aborted) {
    return { status: "error", error: "Aborted", windows: [] };
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), USAGE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(USAGE_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(accountId.length > 0 ? { "ChatGPT-Account-Id": accountId } : {}),
      },
      method: "GET",
      signal: options.signal,
    });
    if (options.signal.aborted) {
      return { status: "error", error: "Aborted", windows: [] };
    }
    const text = await response.text();
    if (options.signal.aborted) {
      return { status: "error", error: "Aborted", windows: [] };
    }
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(text) as Record<string, unknown>;
        if (typeof errorJson.detail === "string") {
          detail = errorJson.detail;
        } else if (
          typeof errorJson.detail === "object" &&
          errorJson.detail !== null
        ) {
          const code = (errorJson.detail as Record<string, unknown>).code;
          if (typeof code === "string") detail = code;
        }
      } catch {
        // Non-JSON error body.
      }
      return {
        status: "error",
        error: `Codex usage request failed: ${detail}`,
        windows: [],
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return {
        status: "error",
        error: "Codex usage response is not valid JSON",
        windows: [],
      };
    }
    return parseWhamUsageResult(json);
  } catch (error) {
    if (options.signal.aborted) {
      return { status: "error", error: "Aborted", windows: [] };
    }
    if (timeoutController.signal.aborted) {
      return { status: "error", error: "RPC timeout", windows: [] };
    }
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      windows: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}
