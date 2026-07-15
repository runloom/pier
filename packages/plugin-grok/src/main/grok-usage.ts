import { parseGrokBillingResult } from "./billing-parse.ts";
import type { AccountUsageResult } from "./types.ts";

export const GROK_BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing";
export const GROK_BILLING_CREDITS_URL =
  "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
export const API_KEY_QUOTA_ERROR =
  "API key accounts cannot report Grok quota — switch to an OIDC account";
export const SESSION_EXPIRED_RELOGIN_ERROR =
  "Grok session expired — re-login required";
const RPC_TIMEOUT_MS = 15_000;
const REFRESH_SKEW_MS = 60_000;

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

interface OidcAuthEntry {
  auth_mode?: unknown;
  create_time?: unknown;
  expires_at?: unknown;
  key?: unknown;
  oidc_client_id?: unknown;
  oidc_issuer?: unknown;
  refresh_token?: unknown;
  [field: string]: unknown;
}

interface SelectedAuthEntry {
  entry: OidcAuthEntry;
  entryKey: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function entryCreateTime(entry: OidcAuthEntry): number {
  if (typeof entry.create_time === "string") {
    const parsed = Date.parse(entry.create_time);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NEGATIVE_INFINITY;
}

function isUsableOidcEntry(entry: OidcAuthEntry): boolean {
  const key = entry.key;
  if (typeof key !== "string" || key.length === 0) return false;
  return (
    entry.auth_mode === "oidc" ||
    (typeof entry.refresh_token === "string" &&
      entry.refresh_token.length > 0) ||
    key.length > 0
  );
}

export function selectOidcAuthEntry(raw: string): SelectedAuthEntry | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const root = asRecord(data);
  if (!root) return null;

  let best: {
    createTime: number;
    entry: OidcAuthEntry;
    entryKey: string;
  } | null = null;
  for (const [entryKey, value] of Object.entries(root)) {
    const entry = asRecord(value) as OidcAuthEntry | null;
    if (!(entry && isUsableOidcEntry(entry))) continue;
    const createTime = entryCreateTime(entry);
    if (!best || createTime > best.createTime) {
      best = { createTime, entry, entryKey };
    }
  }
  return best
    ? {
        entry: best.entry,
        entryKey: best.entryKey,
      }
    : null;
}

export function extractSessionKeyFromAuthJson(raw: string): string | null {
  const selected = selectOidcAuthEntry(raw);
  const key = selected?.entry.key;
  return typeof key === "string" && key.length > 0 ? key : null;
}

function jwtExpMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadPart = parts[1] ?? "";
    const padded = payloadPart + "=".repeat((4 - (payloadPart.length % 4)) % 4);
    const json = Buffer.from(padded, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

function sessionExpiryMs(entry: OidcAuthEntry): number | null {
  if (typeof entry.expires_at === "string" && entry.expires_at.length > 0) {
    const parsed = Date.parse(entry.expires_at);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof entry.key === "string") {
    return jwtExpMs(entry.key);
  }
  return null;
}

function needsRefresh(entry: OidcAuthEntry, nowMs: number): boolean {
  const exp = sessionExpiryMs(entry);
  if (exp === null) return false;
  return exp <= nowMs + REFRESH_SKEW_MS;
}

function resolveTokenEndpoint(entry: OidcAuthEntry): string | null {
  if (typeof entry.oidc_issuer !== "string" || entry.oidc_issuer.length === 0) {
    return null;
  }
  return `${entry.oidc_issuer.replace(/\/$/, "")}/oauth2/token`;
}

function isAuthFailureMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("invalid_grant") ||
    lower.includes("invalid or expired credentials") ||
    lower.includes("refresh token") ||
    lower.includes("no auth context") ||
    lower.includes("unauthorized") ||
    lower.includes("permissiondenied") ||
    /\b401\b/.test(lower) ||
    /\b403\b/.test(lower)
  );
}

function authFailureResult(detail?: string): AccountUsageResult {
  return {
    status: "error",
    error: detail
      ? `${SESSION_EXPIRED_RELOGIN_ERROR} (${detail})`
      : SESSION_EXPIRED_RELOGIN_ERROR,
    windows: [],
  };
}

async function refreshOidcSession(options: {
  entry: OidcAuthEntry;
  entryKey: string;
  fetchImpl: FetchImpl;
  rawAuthJson: string;
  signal: AbortSignal;
}): Promise<{ authJson: string; sessionKey: string } | { error: string }> {
  const refreshToken = options.entry.refresh_token;
  const clientId = options.entry.oidc_client_id;
  const tokenEndpoint = resolveTokenEndpoint(options.entry);
  if (
    typeof refreshToken !== "string" ||
    refreshToken.length === 0 ||
    typeof clientId !== "string" ||
    clientId.length === 0 ||
    !tokenEndpoint
  ) {
    return { error: "missing refresh credentials" };
  }

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  try {
    const response = await options.fetchImpl(tokenEndpoint, {
      body: body.toString(),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
      signal: options.signal,
    });
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = asRecord(JSON.parse(text));
    } catch {
      json = null;
    }
    if (!response.ok) {
      const description =
        (typeof json?.error_description === "string" &&
          json.error_description) ||
        (typeof json?.error === "string" && json.error) ||
        `HTTP ${response.status}`;
      return { error: description };
    }
    const accessToken =
      (typeof json?.access_token === "string" && json.access_token) ||
      (typeof json?.id_token === "string" && json.id_token) ||
      null;
    if (!accessToken) {
      return { error: "token response missing access_token" };
    }

    const root = asRecord(JSON.parse(options.rawAuthJson));
    if (!root) {
      return { error: "invalid auth.json" };
    }
    const nextEntry: OidcAuthEntry = {
      ...options.entry,
      key: accessToken,
    };
    if (
      typeof json?.refresh_token === "string" &&
      json.refresh_token.length > 0
    ) {
      nextEntry.refresh_token = json.refresh_token;
    }
    if (
      typeof json?.expires_in === "number" &&
      Number.isFinite(json.expires_in)
    ) {
      nextEntry.expires_at = new Date(
        Date.now() + json.expires_in * 1000
      ).toISOString();
    } else {
      const exp = jwtExpMs(accessToken);
      if (exp !== null) {
        nextEntry.expires_at = new Date(exp).toISOString();
      }
    }
    root[options.entryKey] = nextEntry;
    return {
      authJson: JSON.stringify(root),
      sessionKey: accessToken,
    };
  } catch (error) {
    if (options.signal.aborted) {
      return { error: "Aborted" };
    }
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchGrokUsage(options: {
  authJson: string | null;
  kind: "api_key" | "oidc";
  fetchImpl?: FetchImpl;
  onAuthJsonUpdated?: (authJson: string) => Promise<void> | void;
  signal: AbortSignal;
}): Promise<AccountUsageResult> {
  if (options.kind === "api_key") {
    return {
      status: "error",
      error: API_KEY_QUOTA_ERROR,
      windows: [],
    };
  }
  if (options.signal.aborted) {
    return { status: "error", error: "Aborted", windows: [] };
  }
  if (!options.authJson) {
    return authFailureResult("session token missing");
  }

  let authJson = options.authJson;
  let selected = selectOidcAuthEntry(authJson);
  if (!selected || typeof selected.entry.key !== "string") {
    return authFailureResult("session token missing");
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeout = AbortSignal.timeout
    ? AbortSignal.timeout(RPC_TIMEOUT_MS)
    : undefined;
  const signal =
    timeout && "any" in AbortSignal
      ? AbortSignal.any([options.signal, timeout])
      : options.signal;

  let sessionKey = selected.entry.key;
  if (needsRefresh(selected.entry, Date.now())) {
    const refreshed = await refreshOidcSession({
      entry: selected.entry,
      entryKey: selected.entryKey,
      fetchImpl,
      rawAuthJson: authJson,
      signal,
    });
    if ("error" in refreshed) {
      if (refreshed.error === "Aborted") {
        return { status: "error", error: "Aborted", windows: [] };
      }
      return authFailureResult(refreshed.error);
    }
    authJson = refreshed.authJson;
    sessionKey = refreshed.sessionKey;
    selected = selectOidcAuthEntry(authJson) ?? selected;
    await options.onAuthJsonUpdated?.(authJson);
  }

  try {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${sessionKey}`,
      "x-grok-client-mode": "cli",
      "x-grok-client-version": "pier-plugin-grok/1.0.0",
    };

    async function request(url: string): Promise<AccountUsageResult> {
      const response = await fetchImpl(url, {
        headers,
        method: "GET",
        signal,
      });
      const text = await response.text();
      if (!response.ok) {
        let message = `Grok billing request failed (${response.status})`;
        try {
          const body = JSON.parse(text) as {
            error?: string;
            message?: string;
          };
          if (typeof body.error === "string" && body.error.length > 0) {
            message = body.error;
          } else if (
            typeof body.message === "string" &&
            body.message.length > 0
          ) {
            message = body.message;
          }
        } catch {
          /* keep status message */
        }
        if (
          response.status === 401 ||
          response.status === 403 ||
          isAuthFailureMessage(message)
        ) {
          return authFailureResult(message);
        }
        return { status: "error", error: message, windows: [] };
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return {
          status: "error",
          error: "Invalid Grok billing response",
          windows: [],
        };
      }
      return parseGrokBillingResult(json);
    }

    async function requestWithOptionalRefresh(
      url: string
    ): Promise<AccountUsageResult> {
      const first = await request(url);
      if (
        first.status !== "error" ||
        !first.error ||
        !isAuthFailureMessage(first.error) ||
        typeof selected?.entry.refresh_token !== "string"
      ) {
        return first;
      }
      // Token looked valid by clock but server rejected it — force refresh once.
      const refreshed = await refreshOidcSession({
        entry: selected.entry,
        entryKey: selected.entryKey,
        fetchImpl,
        rawAuthJson: authJson,
        signal,
      });
      if ("error" in refreshed) {
        if (refreshed.error === "Aborted") {
          return { status: "error", error: "Aborted", windows: [] };
        }
        return authFailureResult(refreshed.error);
      }
      authJson = refreshed.authJson;
      sessionKey = refreshed.sessionKey;
      selected = selectOidcAuthEntry(authJson) ?? selected;
      headers.Authorization = `Bearer ${sessionKey}`;
      await options.onAuthJsonUpdated?.(authJson);
      return await request(url);
    }

    // Default endpoint currently returns used/monthlyLimit cents.
    // format=credits is richer when populated (percent + product split),
    // but can be sparse — try default first, then enrich/fallback to credits.
    const primary = await requestWithOptionalRefresh(GROK_BILLING_URL);
    if (primary.status === "ok" && primary.windows.length > 0) {
      return primary;
    }
    if (
      primary.status === "error" &&
      primary.error?.includes(SESSION_EXPIRED_RELOGIN_ERROR)
    ) {
      return primary;
    }
    const secondary = await requestWithOptionalRefresh(
      GROK_BILLING_CREDITS_URL
    );
    if (secondary.status === "ok" && secondary.windows.length > 0) {
      return secondary;
    }
    return primary.status === "error" ? primary : secondary;
  } catch (error) {
    if (options.signal.aborted) {
      return { status: "error", error: "Aborted", windows: [] };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|aborted/i.test(message)) {
      return {
        status: "error",
        error: "Grok billing request timed out",
        windows: [],
      };
    }
    if (isAuthFailureMessage(message)) {
      return authFailureResult(message);
    }
    return {
      status: "error",
      error: message || "Grok billing request failed",
      windows: [],
    };
  }
}
