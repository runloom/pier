import { describe, expect, it, vi } from "vitest";
import { createUsageCacheEntry } from "../../../packages/plugin-grok/src/main/accounts-usage.ts";
import {
  ACCESS_DENIED_ERROR,
  API_KEY_QUOTA_ERROR,
  BILLING_HOP_TIMEOUT_MS,
  BILLING_TIMEOUT_ERROR,
  classifyBillingHttpError,
  extractSessionKeyFromAuthJson,
  fetchGrokUsage,
  GROK_BILLING_CREDITS_URL,
  GROK_BILLING_URL,
  OIDC_REFRESH_TIMEOUT_MS,
  SESSION_EXPIRED_RELOGIN_ERROR,
  USAGE_OVERALL_DEADLINE_MS,
  USAGE_RETRY_OVERALL_DEADLINE_MS,
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
      classifyBillingHttpError(403, JSON.stringify({ code: "invalid_grant" }))
    ).toEqual({
      kind: "auth",
      detail: "invalid_grant",
    });
  });

  it("classifies permissionDenied as access, not re-login", () => {
    // "permission denied" means authenticated-but-not-allowed; telling the
    // user to re-login would not help.
    expect(
      classifyBillingHttpError(
        403,
        JSON.stringify({ error: "permissionDenied", code: "permissionDenied" })
      )
    ).toEqual({
      kind: "access",
      detail: "permissionDenied",
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
    // sparse credits (no transport retry) + cash default
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
    expect(result.windows[0]).toMatchObject({
      limitName: "Monthly spend",
      usedPercent: expect.closeTo((4112 / 15_000) * 100, 5),
    });
  });

  it("retries credits once after a transport failure before cash fallback", async () => {
    let creditsCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === GROK_BILLING_CREDITS_URL) {
        creditsCalls += 1;
        if (creditsCalls === 1) {
          throw new Error("credits unavailable");
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              config: {
                creditUsagePercent: 9,
                currentPeriod: {
                  end: "2026-07-21T00:00:00.000Z",
                  start: "2026-07-14T00:00:00.000Z",
                  type: "USAGE_PERIOD_TYPE_WEEKLY",
                },
                productUsage: [
                  { product: "GrokBuild", usagePercent: 8 },
                  { product: "Api", usagePercent: 1 },
                ],
              },
            }),
        };
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
    expect(result.windows[0]).toMatchObject({
      limitName: "Weekly limit",
      usedPercent: 9,
    });
    expect(creditsCalls).toBe(2);
    // Cash default must not be hit when credits retry succeeds.
    expect(
      fetchImpl.mock.calls.some((call) => call[0] === GROK_BILLING_URL)
    ).toBe(false);
  });

  it("falls back to cash monthly spend only after credits retries fail", async () => {
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
    expect(result.windows[0]?.limitName).toBe("Monthly spend");
    // credits attempt + credits retry + cash
    expect(
      fetchImpl.mock.calls.filter(
        (call) => call[0] === GROK_BILLING_CREDITS_URL
      ).length
    ).toBe(2);
    expect(
      fetchImpl.mock.calls.some((call) => call[0] === GROK_BILLING_URL)
    ).toBe(true);
  });

  it("uses per-hop budgets so one slow credits hop does not block fallback", async () => {
    // Multi-hop (refresh + credits + fallback) must not share a single 15s budget.
    expect(USAGE_OVERALL_DEADLINE_MS).toBeGreaterThan(BILLING_HOP_TIMEOUT_MS);
    expect(USAGE_OVERALL_DEADLINE_MS).toBeGreaterThanOrEqual(
      OIDC_REFRESH_TIMEOUT_MS + BILLING_HOP_TIMEOUT_MS * 2
    );

    const fetchImpl = vi.fn(
      async (url: string, init?: { signal?: AbortSignal }) => {
        if (url === GROK_BILLING_CREDITS_URL) {
          const hopError = new Error(
            "The operation was aborted due to timeout"
          );
          hopError.name = "TimeoutError";
          // Simulate hop AbortSignal.timeout without burning real wall clock.
          if (init?.signal && !init.signal.aborted) {
            // leave hop signal alone; throw timeout-like transport error
          }
          throw hopError;
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ config: { monthlyLimit: 100, used: 40 } }),
        };
      }
    );

    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ok");
    // credits timeout + credits retry + cash + soft subscription
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      GROK_BILLING_CREDITS_URL,
      expect.any(Object)
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      GROK_BILLING_URL,
      expect.any(Object)
    );
    expect(fetchImpl.mock.calls[3]?.[0]).toContain("/rest/subscriptions");
  });

  it("surfaces a stable timeout error when every hop times out (incl. silent retry)", async () => {
    const fetchImpl = vi.fn(async () => {
      const hopError = new Error("The operation was aborted due to timeout");
      hopError.name = "TimeoutError";
      throw hopError;
    });

    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      status: "error",
      error: BILLING_TIMEOUT_ERROR,
      windows: [],
    });
    // Per attempt: credits + credits-retry + cash; two attempts via silent retry.
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(USAGE_RETRY_OVERALL_DEADLINE_MS).toBeGreaterThan(0);
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
    // plain 403 is not transport/auth-shaped: credits once + cash once
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats a permissionDenied 403 response as an access failure, not re-login", async () => {
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
    expect(result.error).toContain(ACCESS_DENIED_ERROR);
    expect(result.error).not.toContain(SESSION_EXPIRED_RELOGIN_ERROR);
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

describe("fetchGrokUsage subscription soft-attach", () => {
  it("attaches parsed membership without failing usage on subscription errors", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/rest/subscriptions")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              subscriptions: [
                {
                  tier: "SUBSCRIPTION_TIER_GROK_PRO",
                  status: "SUBSCRIPTION_STATUS_ACTIVE",
                  billingPeriodEnd: "2026-07-21T05:50:54.252Z",
                  cancelAtPeriodEnd: false,
                  activeOffer: {
                    type: "ACTIVE_OFFER_FREE_TRIAL",
                    offerEnd: "2026-07-21T05:50:57.308566Z",
                  },
                },
              ],
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: {
              creditUsagePercent: 12,
              currentPeriod: {
                end: "2026-07-21T00:00:00.000Z",
                start: "2026-07-14T00:00:00.000Z",
                type: "USAGE_PERIOD_TYPE_WEEKLY",
              },
            },
          }),
      };
    });

    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ok");
    expect(result.windows[0]?.usedPercent).toBe(12);
    expect(result.subscription).toEqual({
      planType: "pro",
      status: "active",
      expiresAt: Date.parse("2026-07-21T05:50:54.252Z"),
      cancelAtPeriodEnd: false,
      trialEndsAt: Date.parse("2026-07-21T05:50:57.308566Z"),
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/rest/subscriptions"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer session-token-abc",
        }),
      })
    );
  });

  it("keeps usage ok when subscription endpoint fails", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/rest/subscriptions")) {
        return {
          ok: false,
          status: 403,
          text: async () => "Forbidden",
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            config: {
              creditUsagePercent: 8,
              currentPeriod: {
                end: "2026-07-21T00:00:00.000Z",
                start: "2026-07-14T00:00:00.000Z",
                type: "USAGE_PERIOD_TYPE_WEEKLY",
              },
            },
          }),
      };
    });

    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ok");
    expect(result.windows[0]?.usedPercent).toBe(8);
    expect(result.subscription).toBeUndefined();
  });
});

describe("createUsageCacheEntry subscription retention", () => {
  it("drops previous membership when ok result omits subscription", () => {
    const cached = createUsageCacheEntry(
      {
        status: "ok",
        windows: [
          {
            id: "grok:period",
            limitId: "period",
            usedPercent: 10,
          },
        ],
        subscription: {
          planType: "pro",
          status: "active",
          expiresAt: 1,
        },
      },
      undefined,
      100
    );
    const next = createUsageCacheEntry(
      {
        status: "ok",
        windows: [
          {
            id: "grok:period",
            limitId: "period",
            usedPercent: 20,
          },
        ],
      },
      cached,
      200
    );
    expect(next.subscription).toBeUndefined();
    expect(next.windows[0]?.usedPercent).toBe(20);
  });

  it("retains previous membership when usage itself errors", () => {
    const cached = createUsageCacheEntry(
      {
        status: "ok",
        windows: [
          {
            id: "grok:period",
            limitId: "period",
            usedPercent: 10,
          },
        ],
        subscription: {
          planType: "pro",
          status: "active",
          expiresAt: 1,
        },
      },
      undefined,
      100
    );
    const next = createUsageCacheEntry(
      {
        status: "error",
        error: "timeout",
        windows: [],
      },
      cached,
      200
    );
    expect(next.subscription).toEqual({
      planType: "pro",
      status: "active",
      expiresAt: 1,
    });
  });
});
