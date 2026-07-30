import type {
  AccountUsageMetric,
  AccountUsageQuotaMetric,
} from "@pier/plugin-api/account-usage";
import {
  createTimeoutSignal,
  mergeAbortSignals,
} from "@pier/plugin-api/account-usage";
import {
  type CodexMembershipInfo,
  parseCodexAccountCheckMembership,
  parseCodexSubscriptionsMembership,
} from "./codex-membership.ts";
import {
  extractAccountIdFromAccessToken,
  parseCodexAuthJsonTokens,
} from "./token-refresh.ts";
import type { AccountUsageResult } from "./types.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const ACCOUNT_CHECK_URL =
  "https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27";
const SUBSCRIPTIONS_URL = "https://chatgpt.com/backend-api/subscriptions";
const USAGE_TIMEOUT_MS = 15_000;
const CHATGPT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

export type FetchImpl = typeof fetch;

async function fetchCodexMembershipSoft(options: {
  accessToken: string;
  accountId: string;
  fetchImpl: FetchImpl;
  signal: AbortSignal;
}): Promise<CodexMembershipInfo | null> {
  const commonHeaders = {
    Accept: "application/json",
    Authorization: `Bearer ${options.accessToken}`,
    "ChatGPT-Account-Id": options.accountId,
    Referer: "https://chatgpt.com/codex",
    "User-Agent": CHATGPT_USER_AGENT,
  };
  try {
    const checkUrl = new URL(ACCOUNT_CHECK_URL);
    checkUrl.searchParams.set(
      "timezone_offset_min",
      String(new Date().getTimezoneOffset())
    );
    const response = await options.fetchImpl(checkUrl.toString(), {
      headers: {
        ...commonHeaders,
        "x-openai-target-path": "/backend-api/accounts/check",
        "x-openai-target-route": "accounts/check",
      },
      method: "GET",
      signal: options.signal,
    });
    if (response.ok) {
      const parsed = parseCodexAccountCheckMembership(
        JSON.parse(await response.text()),
        options.accountId
      );
      if (parsed) return parsed;
    }
  } catch {
    // Membership is best-effort and must not poison quota data.
  }
  try {
    const subscriptionsUrl = new URL(SUBSCRIPTIONS_URL);
    subscriptionsUrl.searchParams.set("account_id", options.accountId);
    const response = await options.fetchImpl(subscriptionsUrl.toString(), {
      headers: {
        ...commonHeaders,
        "x-openai-target-path": "/backend-api/subscriptions",
        "x-openai-target-route": "subscriptions",
      },
      method: "GET",
      signal: options.signal,
    });
    if (!response.ok) return null;
    return parseCodexSubscriptionsMembership(JSON.parse(await response.text()));
  } catch {
    return null;
  }
}

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
  additional_rate_limits?: WhamAdditionalRateLimit[] | null;
  code_review_rate_limit?: WhamRateLimit | null;
  plan_type?: string;
  rate_limit?: WhamRateLimit | null;
  rate_limit_reset_credits?: {
    available_count?: number;
  } | null;
}

interface WhamAdditionalRateLimit {
  limit_id?: string;
  limit_name?: string;
  metered_feature?: string;
  rate_limit?: WhamRateLimit | null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function mapWhamWindow(
  raw: WhamWindow | null | undefined,
  bucket: {
    availability?: "available" | "blocked";
    groupId: string;
    name?: string;
  },
  position: "primary" | "secondary"
): AccountUsageQuotaMetric | undefined {
  if (
    !raw ||
    typeof raw.used_percent !== "number" ||
    !Number.isFinite(raw.used_percent)
  ) {
    return;
  }
  const result: AccountUsageQuotaMetric = {
    groupId: bucket.groupId,
    id: `${bucket.groupId}:${position}`,
    kind: "quota",
    usedPercent: clampPercent(raw.used_percent),
    ...(bucket.name ? { name: bucket.name } : {}),
    ...(bucket.availability ? { availability: bucket.availability } : {}),
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
  raw: WhamRateLimit | null | undefined,
  bucket: { groupId: string; name?: string }
): AccountUsageQuotaMetric[] {
  if (!raw) return [];
  const availability =
    raw.allowed === false || raw.limit_reached === true
      ? ("blocked" as const)
      : undefined;
  const mappedBucket = {
    ...bucket,
    ...(availability ? { availability } : {}),
  };
  return [
    mapWhamWindow(raw.primary_window, mappedBucket, "primary"),
    mapWhamWindow(raw.secondary_window, mappedBucket, "secondary"),
  ]
    .filter((metric): metric is AccountUsageQuotaMetric => metric !== undefined)
    .sort(
      (left, right) =>
        (left.windowMinutes ?? Number.POSITIVE_INFINITY) -
        (right.windowMinutes ?? Number.POSITIVE_INFINITY)
    );
}

export function parseWhamUsageResult(json: unknown): AccountUsageResult {
  if (typeof json !== "object" || json === null) {
    return { status: "error", error: "Invalid usage response", metrics: [] };
  }
  const data = json as WhamUsageResponse;
  const out: AccountUsageResult = { status: "ok", metrics: [] };
  if (typeof data.plan_type === "string" && data.plan_type.length > 0) {
    out.planType = data.plan_type;
  }
  out.metrics.push(...mapWhamRateLimit(data.rate_limit, { groupId: "codex" }));
  if (data.code_review_rate_limit) {
    out.metrics.push(
      ...mapWhamRateLimit(data.code_review_rate_limit, {
        groupId: "codex:code_review",
      })
    );
  }

  const groupCounts = new Map<string, number>();
  for (const additional of data.additional_rate_limits ?? []) {
    const name =
      typeof additional.limit_name === "string" &&
      additional.limit_name.trim().length > 0
        ? additional.limit_name.trim()
        : undefined;
    const preferredId =
      (typeof additional.limit_id === "string" && additional.limit_id.trim()) ||
      (typeof additional.metered_feature === "string" &&
        additional.metered_feature.trim()) ||
      (name
        ? `additional:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
        : "additional:quota");
    const seen = groupCounts.get(preferredId) ?? 0;
    groupCounts.set(preferredId, seen + 1);
    const groupId = seen === 0 ? preferredId : `${preferredId}#${seen + 1}`;
    out.metrics.push(
      ...mapWhamRateLimit(additional.rate_limit, {
        groupId,
        ...(name ? { name } : {}),
      })
    );
  }

  const handledTopLevel = new Set([
    "additional_rate_limits",
    "code_review_rate_limit",
    "plan_type",
    "rate_limit",
    "rate_limit_reset_credits",
  ]);
  for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
    if (
      handledTopLevel.has(key) ||
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      continue;
    }
    const candidate = value as Record<string, unknown>;
    if (!("primary_window" in candidate || "secondary_window" in candidate)) {
      continue;
    }
    out.metrics.push(
      ...mapWhamRateLimit(candidate as WhamRateLimit, {
        groupId: `codex:${key}`,
      })
    );
  }

  const availableCount = data.rate_limit_reset_credits?.available_count;
  // 0 表示没有可用重置次数：不进指标列表，避免 UI 展示「额度重置次数 0」
  if (
    typeof availableCount === "number" &&
    Number.isInteger(availableCount) &&
    availableCount > 0
  ) {
    const resetCredits: AccountUsageMetric = {
      format: "count",
      id: "codex:reset-credits",
      kind: "scalar",
      value: availableCount,
    };
    out.metrics.push(resetCredits);
  }

  if (out.metrics.length === 0) {
    return {
      status: "error",
      error: "No supported usage metrics in response",
      metrics: [],
      ...(out.planType ? { planType: out.planType } : {}),
    };
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
      metrics: [],
    };
  }

  const accessToken = parsed.tokens.access_token;
  const accountId =
    parsed.tokens.account_id ||
    extractAccountIdFromAccessToken(accessToken) ||
    "";

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (options.signal.aborted) {
    return { status: "error", error: "Aborted", metrics: [] };
  }

  const timeoutSignal = createTimeoutSignal(USAGE_TIMEOUT_MS);
  const requestSignal = mergeAbortSignals([options.signal, timeoutSignal]);
  try {
    const response = await fetchImpl(USAGE_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(accountId.length > 0 ? { "ChatGPT-Account-Id": accountId } : {}),
      },
      method: "GET",
      signal: requestSignal,
    });
    if (options.signal.aborted) {
      return { status: "error", error: "Aborted", metrics: [] };
    }
    const text = await response.text();
    if (options.signal.aborted) {
      return { status: "error", error: "Aborted", metrics: [] };
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
        metrics: [],
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return {
        status: "error",
        error: "Codex usage response is not valid JSON",
        metrics: [],
      };
    }
    const result = parseWhamUsageResult(json);
    if (result.status !== "ok" || accountId.length === 0) return result;
    const membership = await fetchCodexMembershipSoft({
      accessToken,
      accountId,
      fetchImpl,
      signal: requestSignal,
    });
    return membership
      ? {
          ...result,
          membershipResolved: true,
          planType: membership.planType,
          ...(membership.expiresAt === undefined
            ? {}
            : { subscriptionExpiresAt: membership.expiresAt }),
        }
      : result;
  } catch (error) {
    if (options.signal.aborted) {
      return { status: "error", error: "Aborted", metrics: [] };
    }
    if (timeoutSignal?.aborted) {
      return {
        status: "error",
        error: "Codex usage request timed out",
        metrics: [],
      };
    }
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      metrics: [],
    };
  }
}
