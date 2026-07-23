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
    expect(result.windows).toHaveLength(2);
    expect(result.windows[0]).toMatchObject({
      id: "codex:primary",
      limitId: "codex",
      usedPercent: 12,
      windowMinutes: 300,
      resetsAt: (nowSeconds + 600) * 1000,
    });
    expect(result.windows[1]).toMatchObject({
      id: "codex:secondary",
      limitId: "codex",
      usedPercent: 34,
      windowMinutes: 10_080,
    });
    expect(result.windows[1]?.resetsAt).toBeTypeOf("number");
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

    expect(result.windows.map((window) => window.limitId)).toEqual([
      "codex",
      "codex:code_review",
    ]);
    expect(result.windows[1]).toMatchObject({
      id: "codex:code_review:primary",
      usedPercent: 9,
    });
  });

  it("returns an error result for invalid payloads", () => {
    expect(parseWhamUsageResult(null)).toEqual({
      status: "error",
      error: "Invalid usage response",
      windows: [],
    });
  });
});

describe("fetchCodexUsageHttp", () => {
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
    expect(result.windows[0]).toMatchObject({
      id: "codex:primary",
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
      windows: [],
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
      windows: [],
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
      windows: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
