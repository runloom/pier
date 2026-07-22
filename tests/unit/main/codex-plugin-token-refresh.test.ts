import { describe, expect, it, vi } from "vitest";
import {
  buildUpdatedAuthJson,
  extractAccountIdFromAccessToken,
  isAccessTokenExpired,
  maybeRefreshAuthJson,
  parseCodexAuthJsonTokens,
  refreshAccessToken,
} from "../../../packages/plugin-codex/src/main/token-refresh.ts";

function encodeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

function makeAccessToken(options: {
  accountId?: string;
  expSeconds: number;
}): string {
  return encodeJwt({
    exp: options.expSeconds,
    "https://api.openai.com/auth": {
      ...(options.accountId ? { chatgpt_account_id: options.accountId } : {}),
    },
  });
}

function makeIdToken(options: {
  email?: string;
  planType?: string;
  accountId?: string;
  subscriptionUntil?: string;
}): string {
  return encodeJwt({
    email: options.email ?? "user@example.com",
    "https://api.openai.com/auth": {
      ...(options.accountId ? { chatgpt_account_id: options.accountId } : {}),
      ...(options.planType ? { chatgpt_plan_type: options.planType } : {}),
      ...(options.subscriptionUntil
        ? { chatgpt_subscription_active_until: options.subscriptionUntil }
        : {}),
    },
  });
}

function makeAuthJson(options: {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  accountId?: string;
}): string {
  return JSON.stringify({
    OPENAI_API_KEY: "sk-keep",
    last_refresh: 123,
    tokens: {
      access_token: options.accessToken,
      id_token: options.idToken,
      refresh_token: options.refreshToken ?? "refresh-token",
      account_id: options.accountId ?? "acct-1",
    },
  });
}

describe("isAccessTokenExpired", () => {
  it("returns true within the 5-minute skew window", () => {
    const nowMs = Date.parse("2026-07-23T00:00:00.000Z");
    const expSeconds = Math.floor(nowMs / 1000) + 4 * 60; // 4 min left
    expect(isAccessTokenExpired(makeAccessToken({ expSeconds }), nowMs)).toBe(
      true
    );
  });

  it("returns false when exp is safely beyond the skew window", () => {
    const nowMs = Date.parse("2026-07-23T00:00:00.000Z");
    const expSeconds = Math.floor(nowMs / 1000) + 10 * 60; // 10 min left
    expect(isAccessTokenExpired(makeAccessToken({ expSeconds }), nowMs)).toBe(
      false
    );
  });

  it("returns true for malformed tokens", () => {
    expect(isAccessTokenExpired("not-a-jwt")).toBe(true);
  });
});

describe("extractAccountIdFromAccessToken", () => {
  it("reads chatgpt_account_id from the auth namespace claim", () => {
    const token = makeAccessToken({
      accountId: "acct-xyz",
      expSeconds: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(extractAccountIdFromAccessToken(token)).toBe("acct-xyz");
  });

  it("returns null when the claim is missing", () => {
    const token = makeAccessToken({
      expSeconds: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(extractAccountIdFromAccessToken(token)).toBeNull();
  });
});

describe("parseCodexAuthJsonTokens / buildUpdatedAuthJson", () => {
  it("parses required token fields and preserves extra fields on update", () => {
    const accessToken = makeAccessToken({
      accountId: "acct-1",
      expSeconds: Math.floor(Date.now() / 1000) + 3600,
    });
    const idToken = makeIdToken({ planType: "pro" });
    const raw = makeAuthJson({
      accessToken,
      idToken,
      refreshToken: "rt-old",
      accountId: "acct-1",
    });

    expect(parseCodexAuthJsonTokens(raw)).toMatchObject({
      tokens: {
        access_token: accessToken,
        id_token: idToken,
        refresh_token: "rt-old",
        account_id: "acct-1",
      },
    });

    const updated = JSON.parse(
      buildUpdatedAuthJson(raw, {
        access_token: "access-new",
        id_token: "id-new",
        refresh_token: "rt-new",
      })
    );
    expect(updated.OPENAI_API_KEY).toBe("sk-keep");
    expect(updated.last_refresh).toBe(123);
    expect(updated.tokens).toMatchObject({
      access_token: "access-new",
      id_token: "id-new",
      refresh_token: "rt-new",
      account_id: "acct-1",
    });
  });

  it("returns null for malformed auth.json", () => {
    expect(parseCodexAuthJsonTokens("{")).toBeNull();
    expect(parseCodexAuthJsonTokens(JSON.stringify({ tokens: {} }))).toBeNull();
  });
});

describe("refreshAccessToken", () => {
  it("exchanges refresh_token and falls back to current id_token when omitted", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: "access-2",
          // id_token intentionally omitted
          refresh_token: "refresh-2",
        }),
    }));

    const result = await refreshAccessToken("refresh-1", {
      currentIdToken: "id-fallback",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      accessToken: "access-2",
      idToken: "id-fallback",
      refreshToken: "refresh-2",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://auth.openai.com/oauth/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      })
    );
  });

  it("reuses the input refresh_token when the response omits it", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: "access-2",
          id_token: "id-2",
        }),
    }));

    await expect(
      refreshAccessToken("refresh-keep", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      accessToken: "access-2",
      idToken: "id-2",
      refreshToken: "refresh-keep",
    });
  });

  it("returns a structured error on non-OK token endpoint responses", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "invalid_grant" }),
    }));

    await expect(
      refreshAccessToken("refresh-bad", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      error: "Token refresh failed: invalid_grant",
    });
  });
});

describe("maybeRefreshAuthJson", () => {
  it("skips network refresh when the access token is still fresh", async () => {
    const nowMs = Date.now();
    const accessToken = makeAccessToken({
      accountId: "acct-1",
      expSeconds: Math.floor(nowMs / 1000) + 3600,
    });
    const idToken = makeIdToken({
      planType: "pro",
      accountId: "acct-1",
      subscriptionUntil: "2026-08-10T00:00:00.000Z",
    });
    const raw = makeAuthJson({ accessToken, idToken });
    const fetchImpl = vi.fn();

    const result = await maybeRefreshAuthJson(raw, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      authJson: raw,
      refreshed: false,
      identity: {
        email: "user@example.com",
        planType: "pro",
        providerAccountId: "acct-1",
        subscriptionExpiresAt: Date.parse("2026-08-10T00:00:00.000Z"),
      },
    });
  });

  it("refreshes an expired token and returns updated auth.json + identity", async () => {
    const nowMs = Date.now();
    const expiredAccess = makeAccessToken({
      accountId: "acct-1",
      expSeconds: Math.floor(nowMs / 1000) - 60,
    });
    const oldId = makeIdToken({ planType: "plus", accountId: "acct-1" });
    const raw = makeAuthJson({
      accessToken: expiredAccess,
      idToken: oldId,
      refreshToken: "rt-1",
    });

    const nextAccess = makeAccessToken({
      accountId: "acct-1",
      expSeconds: Math.floor(nowMs / 1000) + 3600,
    });
    const nextId = makeIdToken({
      planType: "pro",
      accountId: "acct-1",
      subscriptionUntil: "2026-09-01T00:00:00.000Z",
    });

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: nextAccess,
          id_token: nextId,
          refresh_token: "rt-2",
        }),
    }));

    const result = await maybeRefreshAuthJson(raw, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result?.refreshed).toBe(true);
    expect(result?.identity).toEqual({
      email: "user@example.com",
      planType: "pro",
      providerAccountId: "acct-1",
      subscriptionExpiresAt: Date.parse("2026-09-01T00:00:00.000Z"),
    });
    const parsed = parseCodexAuthJsonTokens(result?.authJson ?? "");
    expect(parsed?.tokens).toMatchObject({
      access_token: nextAccess,
      id_token: nextId,
      refresh_token: "rt-2",
    });
  });

  it("keeps the original auth.json when refresh fails", async () => {
    const nowMs = Date.now();
    const expiredAccess = makeAccessToken({
      accountId: "acct-1",
      expSeconds: Math.floor(nowMs / 1000) - 60,
    });
    const idToken = makeIdToken({ planType: "pro", accountId: "acct-1" });
    const raw = makeAuthJson({
      accessToken: expiredAccess,
      idToken,
      refreshToken: "rt-stale",
    });
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: "invalid_grant" }),
    }));

    const result = await maybeRefreshAuthJson(raw, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toMatchObject({
      authJson: raw,
      refreshed: false,
      identity: {
        email: "user@example.com",
        planType: "pro",
        providerAccountId: "acct-1",
      },
    });
  });
});
