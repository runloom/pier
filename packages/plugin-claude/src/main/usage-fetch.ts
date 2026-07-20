import {
  createTimeoutSignal,
  isTimeoutOrAbortError,
  mergeAbortSignals,
} from "@pier/plugin-api/account-usage";
import type { ClaudeUsageWindow } from "../shared/accounts.ts";
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
  status: "error" | "ok";
  windows: ClaudeUsageWindow[];
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

function windowFromBucket(
  bucket: unknown,
  limitId: string,
  limitName: string,
  windowMinutes: number
): ClaudeUsageWindow | null {
  const record = asRecord(bucket);
  const utilization = record?.utilization;
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) {
    return null;
  }
  const resetsAt = parseResetsAt(record?.resets_at);
  return {
    id: `claude:${limitId}`,
    limitId,
    limitName,
    usedPercent: utilization,
    windowMinutes,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

function windowsFromLimitsArray(limits: unknown): ClaudeUsageWindow[] {
  if (!Array.isArray(limits)) {
    return [];
  }
  const windows: ClaudeUsageWindow[] = [];
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
    let limitId: string;
    let limitName: string;
    let windowMinutes: number | undefined;
    if (kind === "session") {
      limitId = "session";
      limitName = "Session";
      windowMinutes = 300;
    } else if (kind === "weekly_all") {
      limitId = "weekly";
      limitName = "Weekly limit";
      windowMinutes = 10_080;
    } else if (kind === "weekly_scoped") {
      const scopeKey = (scopeName ?? "model").toLowerCase();
      limitId = `weekly:${scopeKey}`;
      limitName = scopeName ?? "Weekly limit";
      windowMinutes = 10_080;
    } else {
      continue;
    }
    const resetsAt = parseResetsAt(record.resets_at);
    windows.push({
      id: `claude:${limitId}`,
      limitId,
      limitName,
      usedPercent: percent,
      ...(windowMinutes === undefined ? {} : { windowMinutes }),
      ...(resetsAt === undefined ? {} : { resetsAt }),
    });
  }
  return windows;
}

/** Parse the OAuth usage payload (flat buckets and/or `limits` array). */
export function parseUsagePayload(payload: unknown): ClaudeUsageWindow[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }
  const fromLimits = windowsFromLimitsArray(root.limits);
  if (fromLimits.length > 0) {
    return fromLimits;
  }
  const windows: ClaudeUsageWindow[] = [];
  const session = windowFromBucket(root.five_hour, "session", "Session", 300);
  if (session) {
    windows.push(session);
  }
  const weekly = windowFromBucket(
    root.seven_day,
    "weekly",
    "Weekly limit",
    10_080
  );
  if (weekly) {
    windows.push(weekly);
  }
  const opus = windowFromBucket(
    root.seven_day_opus,
    "weekly:opus",
    "Opus",
    10_080
  );
  if (opus) {
    windows.push(opus);
  }
  const sonnet = windowFromBucket(
    root.seven_day_sonnet,
    "weekly:sonnet",
    "Sonnet",
    10_080
  );
  if (sonnet) {
    windows.push(sonnet);
  }
  return windows;
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
      status: "error",
      windows: [],
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
      return { error: LOGIN_EXPIRED_ERROR, status: "error", windows: [] };
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
      return { error: LOGIN_EXPIRED_ERROR, status: "error", windows: [] };
    }
    if (response.status === 429) {
      return {
        error: "Claude usage is rate limited — try again later",
        status: "error",
        windows: [],
      };
    }
    if (!response.ok) {
      return {
        error: `Claude usage request failed (HTTP ${response.status})`,
        status: "error",
        windows: [],
      };
    }
    return { status: "ok", windows: parseUsagePayload(await response.json()) };
  } catch (error) {
    if (isTimeoutOrAbortError(error)) {
      return {
        error: opts.signal.aborted ? "Aborted" : USAGE_TIMEOUT_ERROR,
        status: "error",
        windows: [],
      };
    }
    return {
      error: error instanceof Error ? error.message : String(error),
      status: "error",
      windows: [],
    };
  }
}
