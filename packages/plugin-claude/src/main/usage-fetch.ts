import {
  type AccountUsageMetric,
  type AccountUsageQuotaMetric,
  createTimeoutSignal,
  isTimeoutOrAbortError,
  mergeAbortSignals,
} from "@pier/plugin-api/account-usage";
import {
  CLAUDE_CODE_USER_AGENT,
  CLAUDE_OAUTH_BETA_HEADER,
  type FetchImpl,
  LOGIN_EXPIRED_ERROR,
  mergeRefreshedTokens,
  parseCredentialEnvelope,
  refreshAccessToken,
} from "./oauth.ts";

export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const USAGE_TIMEOUT_ERROR = "Claude usage request timed out";
export const USAGE_HOP_TIMEOUT_MS = 15_000;
/** Refresh the access token this long before it actually expires. */
export const TOKEN_REFRESH_SKEW_MS = 60_000;

export interface AccountUsageResult {
  error?: string;
  metrics: AccountUsageMetric[];
  status: "error" | "ok";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseResetsAt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Unix seconds vs ms: usage payloads use ISO strings or unix seconds.
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return;
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "quota"
  );
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function windowFromBucket(
  bucket: unknown,
  groupId: string,
  name: string,
  windowMinutes?: number
): AccountUsageQuotaMetric | null {
  const record = asRecord(bucket);
  const utilization = record?.utilization ?? record?.percent;
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) {
    return null;
  }
  const resetsAt = parseResetsAt(record?.resets_at);
  return {
    groupId,
    id: groupId,
    kind: "quota",
    name,
    usedPercent: Math.min(100, Math.max(0, utilization)),
    ...(windowMinutes === undefined ? {} : { windowMinutes }),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

function explicitWindowMinutes(
  record: Record<string, unknown>
): number | undefined {
  const direct =
    record.window_duration_mins ??
    record.window_duration_minutes ??
    record.window_minutes;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const seconds = record.window_seconds ?? record.window_duration_seconds;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds / 60);
  }
  return;
}

function windowsFromLimitsArray(limits: unknown): AccountUsageQuotaMetric[] {
  if (!Array.isArray(limits)) {
    return [];
  }
  const windows: AccountUsageQuotaMetric[] = [];
  for (const entry of limits) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const kind = typeof record.kind === "string" ? record.kind : "";
    const percent = record.percent ?? record.utilization;
    if (typeof percent !== "number" || !Number.isFinite(percent)) {
      continue;
    }
    const scope = asRecord(asRecord(record.scope)?.model);
    const scopeName =
      typeof scope?.display_name === "string" ? scope.display_name : undefined;
    let groupId: string;
    let name: string;
    let windowMinutes: number | undefined;
    if (kind === "session") {
      groupId = "claude:session";
      name = "Session";
      windowMinutes = 300;
    } else if (kind === "weekly_all") {
      groupId = "claude:weekly";
      name = "Weekly limit";
      windowMinutes = 10_080;
    } else if (kind === "weekly_scoped") {
      const scopeKey = slug(scopeName ?? "model");
      groupId = `claude:weekly:${scopeKey}`;
      name = scopeName ?? "Weekly limit";
      windowMinutes = 10_080;
    } else {
      const kindKey = slug(kind || "quota");
      const scopeKey = scopeName ? `:${slug(scopeName)}` : "";
      groupId = `claude:${kindKey}${scopeKey}`;
      name = scopeName ?? humanize(kind || "quota");
      windowMinutes = explicitWindowMinutes(record);
    }
    const resetsAt = parseResetsAt(record.resets_at);
    windows.push({
      groupId,
      id: groupId,
      kind: "quota",
      name,
      usedPercent: Math.min(100, Math.max(0, percent)),
      ...(windowMinutes === undefined ? {} : { windowMinutes }),
      ...(resetsAt === undefined ? {} : { resetsAt }),
    });
  }
  return windows;
}

/** Parse the OAuth usage payload (flat buckets and/or `limits` array). */
export function parseUsagePayload(payload: unknown): AccountUsageMetric[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }
  const fromLimits = windowsFromLimitsArray(root.limits);
  const metrics: AccountUsageMetric[] = [...fromLimits];
  const existingIds = new Set(metrics.map((metric) => metric.id));
  const knownFlat: Record<
    string,
    { groupId: string; name: string; windowMinutes: number }
  > = {
    five_hour: {
      groupId: "claude:session",
      name: "Session",
      windowMinutes: 300,
    },
    seven_day: {
      groupId: "claude:weekly",
      name: "Weekly limit",
      windowMinutes: 10_080,
    },
    seven_day_opus: {
      groupId: "claude:weekly:opus",
      name: "Opus",
      windowMinutes: 10_080,
    },
    seven_day_sonnet: {
      groupId: "claude:weekly:sonnet",
      name: "Sonnet",
      windowMinutes: 10_080,
    },
  };
  for (const [key, value] of Object.entries(root)) {
    if (key === "limits") continue;
    const known = knownFlat[key];
    const record = asRecord(value);
    const groupId = known?.groupId ?? `claude:${slug(key)}`;
    if (
      existingIds.has(groupId) ||
      !record ||
      (typeof record.utilization !== "number" &&
        typeof record.percent !== "number")
    ) {
      continue;
    }
    const metric = windowFromBucket(
      value,
      groupId,
      known?.name ?? humanize(key),
      known?.windowMinutes ?? explicitWindowMinutes(record)
    );
    if (metric) {
      metrics.push(metric);
      existingIds.add(metric.id);
    }
  }
  const extraUsage = asRecord(root.extra_usage);
  const usedCredits = extraUsage?.used_credits;
  if (typeof usedCredits === "number" && Number.isFinite(usedCredits)) {
    metrics.push({
      currency: "USD",
      format: "currency",
      id: "claude:extra-usage-used",
      kind: "scalar",
      name: "Extra usage",
      value: usedCredits / 100,
    });
  }
  const monthlyLimit = extraUsage?.monthly_limit;
  if (typeof monthlyLimit === "number" && Number.isFinite(monthlyLimit)) {
    metrics.push({
      currency: "USD",
      format: "currency",
      id: "claude:extra-usage-limit",
      kind: "scalar",
      name: "Extra usage limit",
      value: monthlyLimit / 100,
    });
  }
  return metrics;
}

function requestUsage(opts: {
  accessToken: string;
  fetchImpl: FetchImpl;
  signal: AbortSignal;
}): Promise<Response> {
  const hop = createTimeoutSignal(USAGE_HOP_TIMEOUT_MS);
  return opts.fetchImpl(CLAUDE_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER,
      "User-Agent": CLAUDE_CODE_USER_AGENT,
    },
    signal: mergeAbortSignals([opts.signal, hop]),
  });
}

/**
 * Fetch usage for one stored credential envelope. Refreshes the access token
 * when expired (or on 401) and reports the rotated envelope through
 * `onCredentialRefreshed` — Anthropic rotates refresh tokens on every use, so
 * the caller must persist it.
 */
export async function fetchClaudeUsage(opts: {
  credential: string;
  fetchImpl?: FetchImpl;
  now?: () => number;
  onCredentialRefreshed: (envelope: string) => Promise<void>;
  signal: AbortSignal;
}): Promise<AccountUsageResult> {
  const fetchImpl: FetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  let envelope = opts.credential;
  let parsed = parseCredentialEnvelope(envelope);
  if (!parsed) {
    return {
      error: "Stored Claude credential is invalid",
      metrics: [],
      status: "error",
    };
  }

  async function refreshEnvelope(): Promise<boolean> {
    if (!parsed?.refreshToken) {
      return false;
    }
    const tokens = await refreshAccessToken({
      fetchImpl,
      now,
      refreshToken: parsed.refreshToken,
      signal: opts.signal,
    });
    envelope = mergeRefreshedTokens(envelope, tokens);
    parsed = parseCredentialEnvelope(envelope);
    await opts.onCredentialRefreshed(envelope);
    return true;
  }

  try {
    if (
      parsed.expiresAt !== undefined &&
      parsed.expiresAt <= now() + TOKEN_REFRESH_SKEW_MS &&
      !(await refreshEnvelope())
    ) {
      return { error: LOGIN_EXPIRED_ERROR, metrics: [], status: "error" };
    }

    let response = await requestUsage({
      accessToken: parsed?.accessToken ?? "",
      fetchImpl,
      signal: opts.signal,
    });
    if (response.status === 401 && (await refreshEnvelope())) {
      response = await requestUsage({
        accessToken: parsed?.accessToken ?? "",
        fetchImpl,
        signal: opts.signal,
      });
    }
    if (response.status === 401 || response.status === 403) {
      return { error: LOGIN_EXPIRED_ERROR, metrics: [], status: "error" };
    }
    if (response.status === 429) {
      return {
        error: "Claude usage is rate limited — try again later",
        metrics: [],
        status: "error",
      };
    }
    if (!response.ok) {
      return {
        error: `Claude usage request failed (HTTP ${response.status})`,
        metrics: [],
        status: "error",
      };
    }
    const metrics = parseUsagePayload(await response.json());
    return metrics.length > 0
      ? { metrics, status: "ok" }
      : {
          error: "No supported usage metrics in Claude response",
          metrics: [],
          status: "error",
        };
  } catch (error) {
    if (isTimeoutOrAbortError(error)) {
      return {
        error: opts.signal.aborted ? "Aborted" : USAGE_TIMEOUT_ERROR,
        metrics: [],
        status: "error",
      };
    }
    return {
      error: error instanceof Error ? error.message : String(error),
      metrics: [],
      status: "error",
    };
  }
}
