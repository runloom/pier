import { describe, expect, it, vi } from "vitest";
import { LOGIN_EXPIRED_ERROR } from "../../../packages/plugin-claude/src/main/oauth.ts";
import {
  fetchClaudeUsage,
  parseUsagePayload,
} from "../../../packages/plugin-claude/src/main/usage-fetch.ts";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: "at-1",
      expiresAt: Date.now() + 3_600_000,
      refreshToken: "rt-1",
      subscriptionType: "max",
      ...overrides,
    },
  });
}

describe("claude usage fetch", () => {
  it("parses flat five_hour / seven_day buckets", () => {
    const windows = parseUsagePayload({
      five_hour: { resets_at: "2026-07-20T18:00:00Z", utilization: 33 },
      seven_day: { resets_at: "2026-07-24T00:00:00Z", utilization: 13 },
      seven_day_opus: null,
      seven_day_sonnet: { resets_at: null, utilization: 1 },
    });
    expect(windows.map((w) => w.limitId)).toEqual([
      "session",
      "weekly",
      "weekly:sonnet",
    ]);
    expect(windows[0]).toMatchObject({
      limitName: "Session",
      usedPercent: 33,
      windowMinutes: 300,
    });
    expect(windows[0]?.resetsAt).toBe(Date.parse("2026-07-20T18:00:00Z"));
  });

  it("prefers the structured limits array when present", () => {
    const windows = parseUsagePayload({
      five_hour: null,
      limits: [
        { kind: "session", percent: 41, resets_at: 1_790_000_000 },
        { kind: "weekly_all", percent: 12 },
        {
          kind: "weekly_scoped",
          percent: 60,
          scope: { model: { display_name: "Opus" } },
        },
      ],
    });
    expect(windows.map((w) => w.limitId)).toEqual([
      "session",
      "weekly",
      "weekly:opus",
    ]);
    // Unix seconds get normalized to ms.
    expect(windows[0]?.resetsAt).toBe(1_790_000_000_000);
  });

  it("fetches usage with the required headers", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.anthropic.com/api/oauth/usage");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer at-1");
      expect(headers["anthropic-beta"]).toBe("oauth-2025-04-20");
      expect(headers["User-Agent"]).toMatch(/^claude-code\//);
      return jsonResponse({ five_hour: { utilization: 10 } });
    });
    const result = await fetchClaudeUsage({
      credential: envelope(),
      fetchImpl,
      onCredentialRefreshed: async () => undefined,
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    expect(result.windows).toHaveLength(1);
  });

  it("refreshes a rotated token on 401 and persists the new envelope", async () => {
    let usageCalls = 0;
    const refreshed: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/oauth/token")) {
        return jsonResponse({
          access_token: "at-2",
          expires_in: 3600,
          refresh_token: "rt-2",
        });
      }
      usageCalls += 1;
      if (usageCalls === 1) {
        return jsonResponse({}, 401);
      }
      return jsonResponse({ seven_day: { utilization: 55 } });
    });
    const result = await fetchClaudeUsage({
      credential: envelope(),
      fetchImpl,
      onCredentialRefreshed: async (next) => {
        refreshed.push(next);
      },
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    expect(refreshed).toHaveLength(1);
    expect(JSON.parse(refreshed[0] ?? "").claudeAiOauth).toMatchObject({
      accessToken: "at-2",
      refreshToken: "rt-2",
      subscriptionType: "max",
    });
  });

  it("refreshes proactively when the stored token is expired", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/v1/oauth/token")) {
        return jsonResponse({
          access_token: "at-2",
          expires_in: 3600,
          refresh_token: "rt-2",
        });
      }
      return jsonResponse({ five_hour: { utilization: 1 } });
    });
    const result = await fetchClaudeUsage({
      credential: envelope({ expiresAt: Date.now() - 1000 }),
      fetchImpl,
      onCredentialRefreshed: async () => undefined,
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    // First call must be the token endpoint, not the usage endpoint.
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/v1/oauth/token");
  });

  it("reports expired login when refresh is impossible", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 401));
    const result = await fetchClaudeUsage({
      credential: envelope({ refreshToken: undefined }),
      fetchImpl,
      onCredentialRefreshed: async () => undefined,
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("error");
    expect(result.error).toBe(LOGIN_EXPIRED_ERROR);
  });

  it("maps 429 to a rate-limit error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 429));
    const result = await fetchClaudeUsage({
      credential: envelope(),
      fetchImpl,
      onCredentialRefreshed: async () => undefined,
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("error");
    expect(result.error).toContain("rate limited");
  });
});

describe("claude usage refresh runner", () => {
  it("coalesces concurrent refreshes for the same account", async () => {
    const { createClaudeUsageRefreshRunner } = await import(
      "../../../packages/plugin-claude/src/main/accounts-usage-refresh.ts"
    );
    const { createClaudeAccountsStateStore } = await import(
      "../../../packages/plugin-claude/src/main/state.ts"
    );
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "pier-claude-runner-"));
    try {
      const stateStore = createClaudeAccountsStateStore(
        join(dir, "accounts.json")
      );
      await stateStore.init();
      stateStore.mutate((s) => ({
        ...s,
        accounts: [
          {
            createdAt: 1,
            id: "acc-1",
            provider: "claude" as const,
            providerAccountId: "uuid-1",
            updatedAt: 1,
          },
        ],
        activeAccountId: "acc-1",
        revision: 1,
      }));

      let fetches = 0;
      const fetchImpl = vi.fn(async () => {
        fetches += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return jsonResponse({ five_hour: { utilization: 3 } });
      });
      const runner = createClaudeUsageRefreshRunner({
        accountHomeDir: () => join(dir, "home"),
        emitSnapshot: () => undefined,
        fetchImpl,
        isDisposed: () => false,
        now: Date.now,
        onCredentialRefreshed: async () => undefined,
        provider: {
          readManagedCredentialRaw: async () => envelope(),
        },
        signal: new AbortController().signal,
        stateStore,
        usageCache: {},
      });

      await Promise.all([
        runner({ accountId: "acc-1", force: true }),
        runner({ accountId: "acc-1", force: true }),
      ]);
      expect(fetches).toBe(1);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("treats a vanished account as a silent no-op", async () => {
    const { createClaudeUsageRefreshRunner } = await import(
      "../../../packages/plugin-claude/src/main/accounts-usage-refresh.ts"
    );
    const { createClaudeAccountsStateStore } = await import(
      "../../../packages/plugin-claude/src/main/state.ts"
    );
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "pier-claude-runner-"));
    try {
      const stateStore = createClaudeAccountsStateStore(
        join(dir, "accounts.json")
      );
      await stateStore.init();
      const runner = createClaudeUsageRefreshRunner({
        accountHomeDir: () => join(dir, "home"),
        emitSnapshot: () => undefined,
        isDisposed: () => false,
        now: Date.now,
        onCredentialRefreshed: async () => undefined,
        provider: {
          readManagedCredentialRaw: async () => null,
        },
        signal: new AbortController().signal,
        stateStore,
        usageCache: {},
      });
      // Removed/unknown account id → silent no-op, not a cycle-aborting throw.
      await expect(
        runner({ accountId: "ghost", force: true })
      ).resolves.toBeUndefined();
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
