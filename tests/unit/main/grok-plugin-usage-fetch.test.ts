import { describe, expect, it, vi } from "vitest";
import {
  ACCESS_DENIED_ERROR,
  API_KEY_QUOTA_ERROR,
  classifyBillingHttpError,
  extractSessionKeyFromAuthJson,
  fetchGrokUsage,
  GROK_BILLING_CREDITS_URL,
  GROK_BILLING_URL,
  SESSION_EXPIRED_RELOGIN_ERROR,
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

describe("classifyBillingHttpError", () => {
  it("classifies 401 as session auth failure", () => {
    expect(classifyBillingHttpError(401, "Unauthorized")).toEqual({
      kind: "auth",
      detail: "Unauthorized",
    });
  });

  it("classifies structured auth codes as session failure", () => {
    expect(
      classifyBillingHttpError(
        403,
        JSON.stringify({ error: "permissionDenied", code: "permissionDenied" })
      )
    ).toEqual({
      kind: "auth",
      detail: "permissionDenied",
    });
    expect(
      classifyBillingHttpError(403, JSON.stringify({ code: "invalid_grant" }))
    ).toEqual({
      kind: "auth",
      detail: "invalid_grant",
    });
  });

  it("classifies structured access-denied codes without re-login", () => {
    expect(
      classifyBillingHttpError(403, JSON.stringify({ code: "access_denied" }))
    ).toEqual({
      kind: "access",
      detail: "access_denied",
    });
    expect(
      classifyBillingHttpError(
        403,
        JSON.stringify({ error: "insufficient_permissions" })
      )
    ).toEqual({
      kind: "access",
      detail: "insufficient_permissions",
    });
  });

  it("classifies plain 403 Forbidden as generic, not re-login", () => {
    expect(classifyBillingHttpError(403, "Forbidden")).toEqual({
      kind: "generic",
      detail: "Grok billing request failed (403)",
    });
  });
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

  it("falls back to default billing endpoint when credits response has no windows", async () => {
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
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      GROK_BILLING_CREDITS_URL,
      expect.any(Object)
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
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

  it("falls back to default billing after a credits transport failure", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === GROK_BILLING_CREDITS_URL) {
        throw new Error("credits unavailable");
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ config: { monthlyLimit: 100, used: 25 } }),
      };
    });

    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: "ok" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      GROK_BILLING_CREDITS_URL,
      expect.any(Object)
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      GROK_BILLING_URL,
      expect.any(Object)
    );
  });

  it("does not treat a plain 403 response as a re-login failure", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    }));

    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: "error",
      error: "Grok billing request failed (403)",
    });
    expect(result.error).not.toMatch(/re-?login|session expired/i);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats a permissionDenied 403 response as a re-login failure", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: "permissionDenied" }),
    }));

    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: "error" });
    expect(result.error).toContain(SESSION_EXPIRED_RELOGIN_ERROR);
    expect(result.error).toMatch(/permissionDenied/i);
  });

  it("treats access_denied 403 as access error without re-login", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ code: "access_denied" }),
    }));

    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "error",
      error: `${ACCESS_DENIED_ERROR} (access_denied)`,
      windows: [],
    });
    expect(result.error).not.toMatch(/re-?login|session expired/i);
    // Access denial is terminal for both billing shapes.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not fall back after an aborted transport", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      throw new Error("transport aborted");
    });

    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: controller.signal,
    });

    expect(result).toEqual({
      status: "error",
      error: "Aborted",
      windows: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when the caller aborts but credits returns sparse success", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort(new Error("caller cancelled"));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ config: {} }),
      };
    });

    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: controller.signal,
    });

    expect(result).toEqual({
      status: "error",
      error: "Aborted",
      windows: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses credits format first with bearer session key", async () => {
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
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      GROK_BILLING_CREDITS_URL,
      expect.any(Object)
    );
    expect(result.status).toBe("ok");
    expect(result.windows[0]?.usedPercent).toBe(40);
  });

  it("refreshes expired OIDC session before billing and persists new auth", async () => {
    const onAuthJsonUpdated = vi.fn(async (_authJson: string) => undefined);
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
      GROK_BILLING_CREDITS_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-session-token",
        }),
      })
    );
    expect(onAuthJsonUpdated).toHaveBeenCalledTimes(1);
    const firstCall = onAuthJsonUpdated.mock.calls.at(0);
    expect(firstCall).toBeDefined();
    const persisted = JSON.parse(String(firstCall?.[0]));
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
