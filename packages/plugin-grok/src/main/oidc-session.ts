import type { FetchImpl } from "./grok-usage-types.ts";
import { isTimeoutOrAbortError } from "./usage-fetch-timeouts.ts";

export interface OidcAuthEntry {
  auth_mode?: unknown;
  create_time?: unknown;
  expires_at?: unknown;
  key?: unknown;
  oidc_client_id?: unknown;
  oidc_issuer?: unknown;
  refresh_token?: unknown;
  [field: string]: unknown;
}

export interface SelectedAuthEntry {
  entry: OidcAuthEntry;
  entryKey: string;
}

const REFRESH_SKEW_MS = 60_000;

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

export function needsRefresh(entry: OidcAuthEntry, nowMs: number): boolean {
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

export async function refreshOidcSession(options: {
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
    if (options.signal.aborted) {
      return { error: "Aborted" };
    }
    const text = await response.text();
    if (options.signal.aborted) {
      return { error: "Aborted" };
    }
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
    if (options.signal.aborted || isTimeoutOrAbortError(error)) {
      return { error: "Aborted" };
    }
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
