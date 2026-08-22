import type { AccountUsageMetric } from "@pier/plugin-api/account-usage";
import {
  createTimeoutSignal,
  mergeAbortSignals,
} from "@pier/plugin-api/account-usage";

export const CODEX_RESET_CREDITS_METRIC_ID = "codex:reset-credits";
export const CODEX_RESET_CREDITS_URL =
  "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

const RESET_CREDITS_TIMEOUT_MS = 8000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return;
  }
  return value;
}

function nestedResetCredits(
  root: Record<string, unknown>
): Record<string, unknown> | null {
  return (
    asRecord(root.data) ??
    asRecord(root.rate_limit_reset_credits) ??
    asRecord(root.rateLimitResetCredits)
  );
}

function creditsList(source: Record<string, unknown>): unknown {
  return source.credits;
}

function availableCountFromRecord(
  source: Record<string, unknown>
): number | undefined {
  const direct = asNonNegativeInt(
    source.availableCount ?? source.available_count
  );
  if (direct !== undefined) {
    return direct;
  }
  const credits = creditsList(source);
  if (!Array.isArray(credits)) {
    return;
  }
  let count = 0;
  for (const item of credits) {
    const row = asRecord(item);
    if (row?.status === "available") {
      count += 1;
    }
  }
  return count;
}

/** Map /wham/rate-limit-reset-credits JSON into the shared scalar metric. */
export function parseCodexResetCredits(payload: unknown): AccountUsageMetric[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }
  const nested = nestedResetCredits(root);
  const sources = nested ? [root, nested] : [root];
  for (const source of sources) {
    const count = availableCountFromRecord(source);
    if (count !== undefined && count > 0) {
      return [
        {
          format: "count",
          id: CODEX_RESET_CREDITS_METRIC_ID,
          kind: "scalar",
          value: count,
        },
      ];
    }
    if (count === 0) {
      return [];
    }
  }
  return [];
}

export function mergeResetCreditMetrics(
  metrics: readonly AccountUsageMetric[],
  extra: readonly AccountUsageMetric[]
): AccountUsageMetric[] {
  if (extra.length === 0) {
    return [...metrics];
  }
  if (metrics.some((metric) => metric.id === CODEX_RESET_CREDITS_METRIC_ID)) {
    return [...metrics];
  }
  return [...metrics, ...extra];
}

/** Best-effort companion to /wham/usage. 429 / missing field must not poison quota. */
export async function fetchCodexResetCreditsSoft(options: {
  accessToken: string;
  accountId: string;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
}): Promise<AccountUsageMetric[]> {
  try {
    const response = await options.fetchImpl(CODEX_RESET_CREDITS_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${options.accessToken}`,
        "OAI-Product-Sku": "CODEX",
        ...(options.accountId.length > 0
          ? { "ChatGPT-Account-Id": options.accountId }
          : {}),
      },
      method: "GET",
      signal: mergeAbortSignals([
        options.signal,
        createTimeoutSignal(RESET_CREDITS_TIMEOUT_MS),
      ]),
    });
    if (!response.ok || options.signal.aborted) {
      return [];
    }
    return parseCodexResetCredits(JSON.parse(await response.text()));
  } catch {
    return [];
  }
}
