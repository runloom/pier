import { describe, expect, it, vi } from "vitest";
import {
  fetchCodexUsageHttp,
  parseWhamUsageResult,
} from "../../../packages/plugin-codex/src/main/codex-usage-http.ts";

function encodeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" })
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

function makeAuthJson(options?: {
  accessToken?: string;
  accountId?: string;
}): string {
  const accessToken =
    options?.accessToken ??
    encodeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: options?.accountId ?? "acct-from-jwt",
      },
    });
  return JSON.stringify({
    tokens: {
      access_token: accessToken,
      id_token: encodeJwt({ email: "user@example.com" }),
      refresh_token: "rt",
      account_id: options?.accountId ?? "acct-file",
    },
  });
}

describe("parseWhamUsageResult", () => {
  it("maps additional rate limits and reset credits into dynamic metrics", () => {
    const result = parseWhamUsageResult({
      additional_rate_limits: [
        {
          limit_name: "GPT-5.3-Codex-Spark",
          metered_feature: "codex_bengalfox",
          rate_limit: {
            primary_window: {
              limit_window_seconds: 604_800,
              used_percent: 0,
            },
          },
        },
      ],
      rate_limit: {
        primary_window: {
          limit_window_seconds: 18_000,
          used_percent: 12,
        },
      },
      rate_limit_reset_credits: { available_count: 2 },
    });

    expect(result.metrics).toEqual([
      {
        groupId: "codex",
        id: "codex:primary",
        kind: "quota",
        usedPercent: 12,
        windowMinutes: 300,
      },
      {
        groupId: "codex_bengalfox",
        id: "codex_bengalfox:primary",
        kind: "quota",
        name: "GPT-5.3-Codex-Spark",
        usedPercent: 0,
        windowMinutes: 10_080,
      },
      {
        format: "count",
        id: "codex:reset-credits",
        kind: "scalar",
        value: 2,
      },
    ]);
  });

  it("maps plan_type and primary/secondary windows with minute durations", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = parseWhamUsageResult({
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 12,
          limit_window_seconds: 18_000, // 300 min
          reset_at: nowSeconds + 600,
        },
        secondary_window: {
          used_percent: 34,
          limit_window_seconds: 604_800, // 10080 min
          reset_after_seconds: 1200,
        },
      },
    });

    expect(result.status).toBe("ok");
    expect(result.planType).toBe("pro");
    expect(result.metrics).toHaveLength(2);
    expect(result.metrics[0]).toMatchObject({
      groupId: "codex",
      id: "codex:primary",
      kind: "quota",
      usedPercent: 12,
      windowMinutes: 300,
      resetsAt: (nowSeconds + 600) * 1000,
    });
    expect(result.metrics[1]).toMatchObject({
      groupId: "codex",
      id: "codex:secondary",
      kind: "quota",
      usedPercent: 34,
      windowMinutes: 10_080,
    });
    expect(result.metrics[1]).toMatchObject({
      resetsAt: expect.any(Number),
    });
  });

  it("appends code_review windows with a distinct limitId", () => {
    const result = parseWhamUsageResult({
      plan_type: "plus",
      rate_limit: {
        primary_window: {
          used_percent: 5,
          limit_window_seconds: 18_000,
        },
      },
      code_review_rate_limit: {
        primary_window: {
          used_percent: 9,
          limit_window_seconds: 18_000,
        },
      },
    });

    expect(
      result.metrics.map((metric) =>
        metric.kind === "quota" ? metric.groupId : metric.id
      )
    ).toEqual(["codex", "codex:code_review"]);
    expect(result.metrics[1]).toMatchObject({
      groupId: "codex:code_review",
      id: "codex:code_review:primary",
      kind: "quota",
      usedPercent: 9,
    });
  });

  it("returns an error result for invalid payloads", () => {
    expect(parseWhamUsageResult(null)).toEqual({
      status: "error",
      error: "Invalid usage response",
      metrics: [],
    });
  });
});

describe("fetchCodexUsageHttp", () => {
  it("enriches usage with the matching live entitlement", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/wham/usage")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              plan_type: "pro",
              rate_limit: { primary_window: { used_percent: 1 } },
            }),
        };
      }
      if (url.includes("/accounts/check/")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              accounts: {
                "acct-file": {
                  entitlement: {
                    expires_at: "2026-08-28T21:38:26+00:00",
                    subscription_plan: "chatgptpro",
                  },
                },
              },
            }),
        };
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await fetchCodexUsageHttp(makeAuthJson(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      planType: "pro-20x",
      status: "ok",
      subscriptionExpiresAt: Date.parse("2026-08-28T21:38:26+00:00"),
    });
  });

  it("combines the caller signal with an independent request timeout", async () => {
    const caller = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          rate_limit: {
            primary_window: {
              limit_window_seconds: 18_000,
              used_percent: 1,
            },
          },
        }),
    }));

    await fetchCodexUsageHttp(makeAuthJson(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: caller.signal,
    });

    expect(fetchImpl.mock.calls[0]?.[1]?.signal).not.toBe(caller.signal);
  });

  it("sends Authorization and ChatGPT-Account-Id headers", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^Bearer /);
      expect(headers["ChatGPT-Account-Id"]).toBe("acct-file");
      expect(headers.Accept).toBe("application/json");
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            plan_type: "pro",
            rate_limit: {
              primary_window: {
                used_percent: 20,
                limit_window_seconds: 18_000,
                reset_after_seconds: 300,
              },
            },
          }),
      };
    });

    const result = await fetchCodexUsageHttp(makeAuthJson(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: new AbortController().signal,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/wham/usage",
      expect.any(Object)
    );
    expect(result).toMatchObject({
      status: "ok",
      planType: "pro",
    });
    expect(result.metrics[0]).toMatchObject({
      id: "codex:primary",
      kind: "quota",
      usedPercent: 20,
      windowMinutes: 300,
    });
  });

  it("falls back to JWT account id when auth.json omits account_id", async () => {
    const accessToken = encodeJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct-from-jwt",
      },
    });
    const authJson = JSON.stringify({
      tokens: {
        access_token: accessToken,
        id_token: encodeJwt({ email: "user@example.com" }),
        refresh_token: "rt",
        // account_id intentionally empty
        account_id: "",
      },
    });

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["ChatGPT-Account-Id"]).toBe("acct-from-jwt");
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            plan_type: "plus",
            rate_limit: {
              primary_window: {
                used_percent: 1,
                limit_window_seconds: 900,
              },
            },
          }),
      };
    });

    const result = await fetchCodexUsageHttp(authJson, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: new AbortController().signal,
    });
    expect(result.planType).toBe("plus");
  });

  it("maps non-OK usage responses to a structured error", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({
          detail: { code: "token_expired" },
        }),
    }));

    await expect(
      fetchCodexUsageHttp(makeAuthJson(), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      status: "error",
      error: "Codex usage request failed: token_expired",
      metrics: [],
    });
  });

  it("returns an auth.json parse error without calling fetch", async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchCodexUsageHttp("{", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      status: "error",
      error: "Invalid auth.json for usage fetch",
      metrics: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns Aborted when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();
    await expect(
      fetchCodexUsageHttp(makeAuthJson(), {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: controller.signal,
      })
    ).resolves.toEqual({
      status: "error",
      error: "Aborted",
      metrics: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
