import { createHash, randomBytes } from "node:crypto";
import {
  createTimeoutSignal,
  mergeAbortSignals,
} from "@pier/plugin-api/account-usage";

/**
 * Claude Code OAuth (PKCE) endpoints. This is the flow Claude Code itself and
 * community tools (opencode, ccauth, cc-switch) use for Pro/Max login. The
 * client id ships inside Claude Code's cli.js and is shared by every
 * third-party integration; Anthropic has not published a formal spec.
 */
export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const CLAUDE_OAUTH_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
export const CLAUDE_OAUTH_TOKEN_URL =
  "https://console.anthropic.com/v1/oauth/token";
export const CLAUDE_OAUTH_REDIRECT_URI =
  "https://console.anthropic.com/oauth/code/callback";
export const CLAUDE_OAUTH_SCOPE =
  "org:create_api_key user:profile user:inference";
export const CLAUDE_OAUTH_PROFILE_URL =
  "https://api.anthropic.com/api/oauth/profile";
export const CLAUDE_OAUTH_BETA_HEADER = "oauth-2025-04-20";
/**
 * The usage/profile endpoints rate-limit by User-Agent bucket: without a
 * claude-code UA the request hits a near-zero bucket and 429s persistently.
 */
export const CLAUDE_CODE_USER_AGENT = "claude-code/2.1.90";

export const LOGIN_EXPIRED_ERROR =
  "Claude session expired — sign in again with the Claude CLI or re-add the account";
/** Hop timeout for OAuth token/profile requests (mirrors the usage hop). */
export const OAUTH_HOP_TIMEOUT_MS = 15_000;

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface PkcePair {
  challenge: string;
  verifier: string;
}

export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { challenge, verifier };
}

export function buildAuthorizeUrl(pkce: PkcePair): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_OAUTH_CLIENT_ID,
    response_type: "code",
    redirect_uri: CLAUDE_OAUTH_REDIRECT_URI,
    scope: CLAUDE_OAUTH_SCOPE,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state: pkce.verifier,
  });
  return `${CLAUDE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export interface OauthTokens {
  accessToken: string;
  /** ms epoch when the access token expires. */
  expiresAt: number;
  refreshToken: string;
  scopes: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseTokenResponse(payload: unknown, now: number): OauthTokens {
  const root = asRecord(payload);
  const accessToken = root?.access_token;
  const refreshToken = root?.refresh_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Claude OAuth token response is missing access_token");
  }
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    throw new Error("Claude OAuth token response is missing refresh_token");
  }
  const expiresIn =
    typeof root?.expires_in === "number" && root.expires_in > 0
      ? root.expires_in
      : 3600;
  const scope = typeof root?.scope === "string" ? root.scope : "";
  return {
    accessToken,
    expiresAt: now + expiresIn * 1000,
    refreshToken,
    scopes: scope.length > 0 ? scope.split(" ") : [],
  };
}

async function postTokenEndpoint(
  body: Record<string, string>,
  opts: { fetchImpl: FetchImpl; now: () => number; signal?: AbortSignal }
): Promise<OauthTokens> {
  // Always bound the request: a hung token exchange must not strand the UI.
  const response = await opts.fetchImpl(CLAUDE_OAUTH_TOKEN_URL, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: mergeAbortSignals([
      opts.signal,
      createTimeoutSignal(OAUTH_HOP_TIMEOUT_MS),
    ]),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (
      body.grant_type === "refresh_token" &&
      (response.status === 400 || response.status === 401)
    ) {
      throw new Error(LOGIN_EXPIRED_ERROR);
    }
    throw new Error(
      `Claude OAuth token request failed (HTTP ${response.status})${
        detail ? `: ${detail.slice(0, 200)}` : ""
      }`
    );
  }
  return parseTokenResponse(await response.json(), opts.now());
}

/**
 * Exchange a pasted authorization code for tokens. The Anthropic callback
 * page shows `code#state`; accept both the combined form and a plain code.
 */
export function exchangeAuthorizationCode(opts: {
  fetchImpl: FetchImpl;
  now: () => number;
  pastedCode: string;
  signal?: AbortSignal;
  verifier: string;
}): Promise<OauthTokens> {
  const [code, state] = opts.pastedCode.trim().split("#", 2);
  if (!code) {
    throw new Error("Authorization code is empty");
  }
  return postTokenEndpoint(
    {
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      code,
      code_verifier: opts.verifier,
      grant_type: "authorization_code",
      redirect_uri: CLAUDE_OAUTH_REDIRECT_URI,
      state: state ?? opts.verifier,
    },
    opts
  );
}

/**
 * Refresh an access token. Anthropic rotates the refresh token on every use:
 * the caller MUST persist the returned tokens or the account is signed out.
 */
export function refreshAccessToken(opts: {
  fetchImpl: FetchImpl;
  now: () => number;
  refreshToken: string;
  signal?: AbortSignal;
}): Promise<OauthTokens> {
  return postTokenEndpoint(
    {
      client_id: CLAUDE_OAUTH_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
    },
    opts
  );
}

export interface OauthProfile {
  accountUuid: string;
  email: string;
  organizationName?: string | undefined;
  organizationUuid?: string | undefined;
  subscriptionType?: string | undefined;
}

/** Resolve identity + subscription for a fresh token (mirrors ccauth). */
export async function fetchOauthProfile(opts: {
  accessToken: string;
  fetchImpl: FetchImpl;
  signal?: AbortSignal;
}): Promise<OauthProfile> {
  const response = await opts.fetchImpl(CLAUDE_OAUTH_PROFILE_URL, {
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER,
      "User-Agent": CLAUDE_CODE_USER_AGENT,
    },
    signal: mergeAbortSignals([
      opts.signal,
      createTimeoutSignal(OAUTH_HOP_TIMEOUT_MS),
    ]),
  });
  if (!response.ok) {
    throw new Error(`Claude profile request failed (HTTP ${response.status})`);
  }
  const root = asRecord(await response.json());
  const account = asRecord(root?.account);
  const organization = asRecord(root?.organization);
  const accountUuid = account?.uuid;
  const email = account?.email_address ?? account?.email;
  if (typeof accountUuid !== "string" || typeof email !== "string") {
    throw new Error("Claude profile response is missing account identity");
  }
  let subscriptionType: string | undefined;
  if (typeof root?.subscriptionType === "string") {
    subscriptionType = root.subscriptionType;
  } else if (typeof account?.subscription_type === "string") {
    subscriptionType = account.subscription_type;
  }
  return {
    accountUuid,
    email,
    ...(typeof organization?.name === "string"
      ? { organizationName: organization.name }
      : {}),
    ...(typeof organization?.uuid === "string"
      ? { organizationUuid: organization.uuid }
      : {}),
    ...(subscriptionType ? { subscriptionType } : {}),
  };
}

/** Build the `{claudeAiOauth: {...}}` envelope Claude Code stores. */
export function buildCredentialEnvelope(
  tokens: OauthTokens,
  subscriptionType?: string
): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      refreshToken: tokens.refreshToken,
      scopes: tokens.scopes,
      ...(subscriptionType ? { subscriptionType } : {}),
    },
  });
}

export interface ParsedEnvelope {
  accessToken: string;
  expiresAt?: number | undefined;
  refreshToken?: string | undefined;
  scopes: string[];
  subscriptionType?: string | undefined;
}

export function parseCredentialEnvelope(
  credential: string
): ParsedEnvelope | null {
  try {
    const root = asRecord(JSON.parse(credential));
    const oauth = asRecord(root?.claudeAiOauth);
    const accessToken = oauth?.accessToken;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      return null;
    }
    return {
      accessToken,
      scopes: Array.isArray(oauth?.scopes)
        ? oauth.scopes.filter((s): s is string => typeof s === "string")
        : [],
      ...(typeof oauth?.expiresAt === "number"
        ? { expiresAt: oauth.expiresAt }
        : {}),
      ...(typeof oauth?.refreshToken === "string"
        ? { refreshToken: oauth.refreshToken }
        : {}),
      ...(typeof oauth?.subscriptionType === "string"
        ? { subscriptionType: oauth.subscriptionType }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Merge refreshed tokens into an existing envelope, keeping unknown fields
 * (mcpOAuth etc.) intact so a Pier refresh never drops Claude Code state.
 */
export function mergeRefreshedTokens(
  credential: string,
  tokens: OauthTokens
): string {
  let root: Record<string, unknown> = {};
  try {
    root = asRecord(JSON.parse(credential)) ?? {};
  } catch {
    /* corrupt envelope → rebuild from tokens */
  }
  const oauth = asRecord(root.claudeAiOauth) ?? {};
  root.claudeAiOauth = {
    ...oauth,
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    refreshToken: tokens.refreshToken,
    ...(tokens.scopes.length > 0 ? { scopes: tokens.scopes } : {}),
  };
  return JSON.stringify(root);
}
