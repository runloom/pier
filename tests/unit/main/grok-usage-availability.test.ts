import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInflightCoalescer } from "@pier/plugin-api/account-usage";
import { describe, expect, it, vi } from "vitest";
import {
  BILLING_HOP_TIMEOUT_MS,
  fetchGrokUsage,
  GROK_BILLING_CREDITS_URL,
  GROK_BILLING_URL,
  OIDC_REFRESH_TIMEOUT_MS,
  USAGE_OVERALL_DEADLINE_MS,
  USAGE_RETRY_OVERALL_DEADLINE_MS,
} from "../../../packages/plugin-grok/src/main/grok-usage.ts";
import { assertUsageTimeoutBudget } from "../../../packages/plugin-grok/src/main/usage-fetch-timeouts.ts";

const AUTH = JSON.stringify({
  "https://auth.x.ai::test-client": {
    auth_mode: "oidc",
    create_time: "2026-01-01T00:00:00.000Z",
    email: "user@example.com",
    expires_at: "2099-01-01T00:00:00.000Z",
    key: "session-token-abc",
    oidc_client_id: "test-client",
    oidc_issuer: "https://auth.x.ai",
    refresh_token: "refresh",
    user_id: "user-1",
  },
});

const OK_CREDITS = JSON.stringify({
  config: {
    creditUsagePercent: 40,
    currentPeriod: {
      end: "2026-07-21T00:00:00.000Z",
      start: "2026-07-14T00:00:00.000Z",
      type: "USAGE_PERIOD_TYPE_WEEKLY",
    },
  },
});

describe("grok usage availability contract", () => {
  it("keeps multi-hop timeout budgets non-regressible", () => {
    expect(() => assertUsageTimeoutBudget()).not.toThrow();
    expect(USAGE_OVERALL_DEADLINE_MS).toBeGreaterThanOrEqual(
      OIDC_REFRESH_TIMEOUT_MS + BILLING_HOP_TIMEOUT_MS * 2
    );
    expect(USAGE_RETRY_OVERALL_DEADLINE_MS).toBeGreaterThanOrEqual(
      BILLING_HOP_TIMEOUT_MS
    );
    expect(USAGE_OVERALL_DEADLINE_MS).toBeGreaterThan(
      USAGE_RETRY_OVERALL_DEADLINE_MS
    );
  });

  it("does not reintroduce a single short timeout around the whole multi-hop path", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/plugin-grok/src/main/grok-usage.ts"),
      "utf8"
    );
    // Must not go back to one AbortSignal.timeout(15_000) for the entire attempt.
    expect(source).not.toMatch(
      /AbortSignal\.timeout\(\s*15[_\s]*000\s*\)|RPC_TIMEOUT_MS\s*=\s*15[_\s]*000/
    );
    expect(source).toContain("USAGE_OVERALL_DEADLINE_MS");
    expect(source).toContain("BILLING_HOP_TIMEOUT_MS");
    expect(source).toContain("USAGE_RETRY_OVERALL_DEADLINE_MS");
  });

  it("silently retries once after an overall timeout (cold-path recovery)", async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === GROK_BILLING_CREDITS_URL || url === GROK_BILLING_URL) {
        attempt += 1;
        if (attempt <= 2) {
          // First attempt: both hops time out → overall timeout path.
          const err = new Error("The operation was aborted due to timeout");
          err.name = "TimeoutError";
          throw err;
        }
        return {
          ok: true,
          status: 200,
          text: async () => OK_CREDITS,
        };
      }
      throw new Error(`unexpected url ${url}`);
    });

    const result = await fetchGrokUsage({
      authJson: AUTH,
      fetchImpl,
      kind: "oidc",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ok");
    expect(result.windows[0]?.usedPercent).toBe(40);
    // first attempt: credits + fallback; retry: credits success
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not retry when the caller aborts", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
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

  it("coalesces concurrent work for the same key", async () => {
    const coalescer = createInflightCoalescer();
    let runs = 0;
    const task = async (): Promise<number> => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return runs;
    };

    const [a, b, c] = await Promise.all([
      coalescer.run("acc-1", task),
      coalescer.run("acc-1", task),
      coalescer.run("acc-1", task),
    ]);

    expect(runs).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(c).toBe(1);
    expect(coalescer.size()).toBe(0);
  });

  it("account plugins wire shared inflight coalescing for usage refresh", () => {
    // Both plugins host their refresh body in accounts-usage-refresh.ts and
    // must use the shared coalescer from @pier/plugin-api.
    for (const rel of [
      "packages/plugin-grok/src/main/accounts-usage-refresh.ts",
      "packages/plugin-codex/src/main/accounts-usage-refresh.ts",
    ]) {
      const refresh = readFileSync(join(process.cwd(), rel), "utf8");
      expect(refresh).toContain("createInflightCoalescer");
      expect(refresh).toContain("@pier/plugin-api/account-usage");
    }
  });

  it("does not keep per-plugin copies of scheduler/inflight primitives", () => {
    for (const rel of [
      "packages/plugin-grok/src/main/usage-refresh-scheduler.ts",
      "packages/plugin-grok/src/main/usage-inflight.ts",
      "packages/plugin-codex/src/main/usage-refresh-scheduler.ts",
    ]) {
      try {
        readFileSync(join(process.cwd(), rel), "utf8");
        expect.fail(
          `${rel} should be removed; use @pier/plugin-api/account-usage`
        );
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    }
  });
});
