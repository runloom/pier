import { type AccountIdentity, parseIdTokenClaims } from "./identity.ts";

const TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_REFRESH_SKEW_MS = 300_000; // 5 min — matches cockpit-tools
const TOKEN_REFRESH_TIMEOUT_MS = 15_000;

export interface CodexAuthJson {
  tokens: {
    access_token: string;
    id_token: string;
    refresh_token: string;
    account_id: string;
  };
}

/**
 * Parse a JWT payload without signature verification (local stored file).
 * Returns null on malformed tokens.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  const payloadSegment = parts[1];
  if (!payloadSegment) return null;
  try {
    return JSON.parse(
      Buffer.from(payloadSegment, "base64url").toString("utf-8")
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Check if an access_token JWT is expired or will expire within the skew
 * window. Returns true when the token should be refreshed.
 */
export function isAccessTokenExpired(
  accessToken: string,
  nowMs = Date.now()
): boolean {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return true;
  const exp = payload.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return true;
  // exp is in seconds; compare against now in ms.
  return exp * 1000 <= nowMs + TOKEN_REFRESH_SKEW_MS;
}

/**
 * Extract the ChatGPT account_id from an access_token JWT. Used for the
 * `ChatGPT-Account-Id` header in direct HTTP usage queries.
 */
export function extractAccountIdFromAccessToken(
  accessToken: string
): string | null {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;
  const authNs = payload["https://api.openai.com/auth"];
  if (typeof authNs !== "object" || authNs === null) return null;
  const record = authNs as Record<string, unknown>;
  if (
    typeof record.chatgpt_account_id === "string" &&
    record.chatgpt_account_id.length > 0
  ) {
    return record.chatgpt_account_id;
  }
  if (typeof record.account_id === "string" && record.account_id.length > 0) {
    return record.account_id;
  }
  return null;
}

/**
 * Parse a raw auth.json string into the Codex token structure.
 * Returns null if the JSON is malformed or missing required token fields.
 */
export function parseCodexAuthJsonTokens(raw: string): CodexAuthJson | null {
  try {
    const data = JSON.parse(raw);
    const tokens = data?.tokens;
    if (
      typeof tokens?.access_token !== "string" ||
      typeof tokens?.id_token !== "string" ||
      typeof tokens?.refresh_token !== "string"
    ) {
      return null;
    }
    return data as CodexAuthJson;
  } catch {
    return null;
  }
}

/**
 * Build an updated auth.json string from the original content and new tokens.
 * Preserves any extra fields (e.g. OPENAI_API_KEY, last_refresh) from the
 * original structure.
 */
export function buildUpdatedAuthJson(
  originalRaw: string,
  newTokens: { access_token: string; id_token: string; refresh_token: string }
): string {
  try {
    const data = JSON.parse(originalRaw) as Record<string, unknown>;
    data.tokens = {
      ...(typeof data.tokens === "object" && data.tokens !== null
        ? (data.tokens as Record<string, unknown>)
        : {}),
      access_token: newTokens.access_token,
      id_token: newTokens.id_token,
      refresh_token: newTokens.refresh_token,
    };
    return JSON.stringify(data);
  } catch {
    // If the original is unparseable, build a minimal structure.
    return JSON.stringify({ tokens: newTokens });
  }
}

/**
 * Extract the AccountIdentity from a refreshed id_token. Returns null if the
 * new id_token is missing or unparseable.
 */
export function identityFromRefreshedIdToken(
  idToken: string
): AccountIdentity | null {
  return parseIdTokenClaims(idToken);
}

/**
 * Refresh the Codex access_token using the refresh_token grant.
 *
 * Mirrors cockpit-tools' `refresh_access_token_with_fallback`:
 * POST to `https://auth.openai.com/oauth/token` with grant_type=refresh_token.
 * If the response omits id_token, falls back to the current id_token.
 * If the response omits refresh_token, reuses the current one.
 *
 * Returns the new token set on success, or an error string on failure.
 */
export async function refreshAccessToken(
  refreshToken: string,
  options: {
    currentIdToken?: string;
    fetchImpl?: typeof fetch;
    signal: AbortSignal;
  }
): Promise<
  | { accessToken: string; idToken: string; refreshToken: string }
  | { error: string }
> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (options.signal.aborted) {
    return { error: "Aborted" };
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  try {
    const response = await fetchImpl(TOKEN_ENDPOINT, {
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
    if (!response.ok) {
      let errorCode = `HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(text) as Record<string, unknown>;
        if (typeof errorJson.error === "string") {
          errorCode = errorJson.error;
        }
      } catch {
        // Non-JSON error body — use the HTTP status.
      }
      return { error: `Token refresh failed: ${errorCode}` };
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { error: "Token refresh response is not valid JSON" };
    }

    const accessToken =
      typeof json.access_token === "string" ? json.access_token : null;
    if (!accessToken) {
      return { error: "Token refresh response missing access_token" };
    }

    // id_token may be omitted by some token endpoints — fall back to current.
    const idToken =
      (typeof json.id_token === "string" && json.id_token) ||
      (options.currentIdToken && options.currentIdToken.trim().length > 0
        ? options.currentIdToken
        : null);
    if (!idToken) {
      return {
        error:
          "Token refresh response missing id_token and no fallback available",
      };
    }

    // refresh_token may be rotated or omitted — reuse the input when absent.
    const newRefreshToken =
      (typeof json.refresh_token === "string" && json.refresh_token) ||
      refreshToken;

    return { accessToken, idToken, refreshToken: newRefreshToken };
  } catch (error) {
    if (options.signal.aborted) {
      return { error: "Aborted" };
    }
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if an auth.json content needs a token refresh and perform it if so.
 * Returns the updated auth.json content and identity when refreshed, or the
 * original content when no refresh was needed. Returns null on refresh
 * failure (caller should treat as stale identity).
 */
export async function maybeRefreshAuthJson(
  rawAuthJson: string,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  } = {}
): Promise<{
  authJson: string;
  identity: AccountIdentity | null;
  refreshed: boolean;
} | null> {
  const parsed = parseCodexAuthJsonTokens(rawAuthJson);
  if (!parsed) return null;

  if (!isAccessTokenExpired(parsed.tokens.access_token)) {
    return {
      authJson: rawAuthJson,
      identity: parseIdTokenClaims(parsed.tokens.id_token),
      refreshed: false,
    };
  }

  // No refresh_token — can't refresh, use as-is (the codex CLI may handle it).
  if (parsed.tokens.refresh_token.length === 0) {
    return {
      authJson: rawAuthJson,
      identity: parseIdTokenClaims(parsed.tokens.id_token),
      refreshed: false,
    };
  }

  const timeout = AbortSignal.timeout(TOKEN_REFRESH_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  const result = await refreshAccessToken(parsed.tokens.refresh_token, {
    currentIdToken: parsed.tokens.id_token,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    signal,
  });

  if ("error" in result) {
    // Refresh failed — return original with stale identity. The caller can
    // still use the stale identity for plan/email; the expired access_token
    // will cause usage fetch to fail, which is the correct signal.
    return {
      authJson: rawAuthJson,
      identity: parseIdTokenClaims(parsed.tokens.id_token),
      refreshed: false,
    };
  }

  const updatedAuthJson = buildUpdatedAuthJson(rawAuthJson, {
    access_token: result.accessToken,
    id_token: result.idToken,
    refresh_token: result.refreshToken,
  });
  return {
    authJson: updatedAuthJson,
    identity: identityFromRefreshedIdToken(result.idToken),
    refreshed: true,
  };
}
