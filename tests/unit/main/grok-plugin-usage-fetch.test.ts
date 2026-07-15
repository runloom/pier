import { describe, expect, it, vi } from "vitest";
import {
  API_KEY_QUOTA_ERROR,
  extractSessionKeyFromAuthJson,
  fetchGrokUsage,
  GROK_BILLING_CREDITS_URL,
  GROK_BILLING_URL,
} from "../../../packages/plugin-grok/src/main/grok-usage.ts";

const AUTH_ENTRY = {
  auth_mode: "oidc",
  create_time: "2026-01-01T00:00:00.000Z",
  email: "user@example.com",
  key: "session-token-abc",
  oidc_client_id: "test-client",
  oidc_issuer: "https://auth.x.ai",
  refresh_token: "refresh",
  user_id: "user-1",
} as const;

const AUTH = JSON.stringify({
  "https://auth.x.ai::test-client": {
    ...AUTH_ENTRY,
    expires_at: "2099-01-01T00:00:00.000Z",
  },
});

const EXPIRED_AUTH = JSON.stringify({
  "https://auth.x.ai::test-client": {
    ...AUTH_ENTRY,
    expires_at: "2020-01-01T00:00:00.000Z",
  },
});

describe("fetchGrokUsage", () => {
  it("extracts the newest OIDC session key", () => {
    expect(extractSessionKeyFromAuthJson(AUTH)).toBe("session-token-abc");
  });

  it("short-circuits API key accounts", async () => {
    const result = await fetchGrokUsage({
      authJson: null,
      kind: "api_key",
      signal: new AbortController().signal,
    });
    expect(result).toEqual({
      error: API_KEY_QUOTA_ERROR,
      status: "error",
      windows: [],
    });
  });

  it("uses default billing endpoint first with bearer session key", async () => {
    const fetchImpl = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () =>
        url.includes("format=credits")
          ? JSON.stringify({ config: {} })
          : JSON.stringify({
              config: {
                billingPeriodEnd: "2026-08-01T00:00:00+00:00",
                billingPeriodStart: "2026-07-01T00:00:00+00:00",
                monthlyLimit: { val: 15_000 },
                used: { val: 4112 },
              },
            }),
    }));
    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: new AbortController().signal,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      GROK_BILLING_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer session-token-abc",
        }),
      })
    );
    expect(result.status).toBe("ok");
    expect(result.windows[0]?.usedPercent).toBeCloseTo(
      (4112 / 15_000) * 100,
      5
    );
  });

  it("falls back to credits format when default response has no windows", async () => {
    const fetchImpl = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () =>
        url === GROK_BILLING_CREDITS_URL
          ? JSON.stringify({
              config: {
                creditUsagePercent: 40,
                currentPeriod: {
                  end: "2026-07-21T00:00:00.000Z",
                  start: "2026-07-14T00:00:00.000Z",
                  type: "USAGE_PERIOD_TYPE_WEEKLY",
                },
                productUsage: [{ product: "Api", usagePercent: 40 }],
              },
            })
          : JSON.stringify({
              config: {
                currentPeriod: {
                  end: "2026-07-21T00:00:00.000Z",
                  start: "2026-07-14T00:00:00.000Z",
                  type: "USAGE_PERIOD_TYPE_WEEKLY",
                },
                prepaidBalance: { val: 0 },
              },
            }),
    }));
    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: new AbortController().signal,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      GROK_BILLING_CREDITS_URL,
      expect.any(Object)
    );
    expect(result.status).toBe("ok");
    expect(result.windows[0]?.usedPercent).toBe(40);
  });

  it("refreshes expired OIDC session before billing and persists new auth", async () => {
    const onAuthJsonUpdated = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("token")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              access_token: "fresh-session-token",
              expires_in: 3600,
              refresh_token: "refresh-2",
              token_type: "Bearer",
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: {
              billingPeriodEnd: "2026-08-01T00:00:00+00:00",
              billingPeriodStart: "2026-07-01T00:00:00+00:00",
              monthlyLimit: { val: 10_000 },
              used: { val: 2500 },
            },
          }),
      };
    });

    const result = await fetchGrokUsage({
      authJson: EXPIRED_AUTH,
      fetchImpl,
      kind: "oidc",
      onAuthJsonUpdated,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("token"),
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      GROK_BILLING_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-session-token",
        }),
      })
    );
    expect(onAuthJsonUpdated).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(String(onAuthJsonUpdated.mock.calls[0]?.[0]));
    const entry = Object.values(persisted)[0] as {
      key?: string;
      refresh_token?: string;
    };
    expect(entry.key).toBe("fresh-session-token");
    expect(entry.refresh_token).toBe("refresh-2");
  });

  it("maps revoked refresh / invalid credentials to re-login guidance", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("token")) {
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              error: "invalid_grant",
              error_description: "Refresh token has been revoked",
            }),
        };
      }
      return {
        ok: false,
        status: 401,
        text: async () =>
          JSON.stringify({
            error:
              "Invalid or expired credentials (auth_kind=bearer, reason=no auth context)",
          }),
      };
    });

    const result = await fetchGrokUsage({
      authJson: EXPIRED_AUTH,
      fetchImpl,
      kind: "oidc",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/re-?login|session expired/i);
  });
});
