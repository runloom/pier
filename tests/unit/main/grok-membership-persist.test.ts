import { describe, expect, it } from "vitest";
import { applySubscriptionToAccount } from "../../../packages/plugin-grok/src/main/accounts-records.ts";
import { buildAccountsSnapshot } from "../../../packages/plugin-grok/src/main/accounts-snapshot.ts";
import type { GrokAccountRecord } from "../../../packages/plugin-grok/src/main/state.ts";

function record(overrides: Partial<GrokAccountRecord> = {}): GrokAccountRecord {
  return {
    createdAt: 1,
    id: "acc-1",
    kind: "oidc",
    provider: "grok",
    updatedAt: 1,
    email: "user@example.com",
    ...overrides,
  };
}

describe("grok membership persistence", () => {
  it("applySubscriptionToAccount writes plan and expiry", () => {
    const next = applySubscriptionToAccount(
      record(),
      {
        planType: "super_grok_pro",
        status: "active",
        expiresAt: 1000,
        cancelAtPeriodEnd: false,
      },
      50
    );
    expect(next.subscription).toEqual({
      planType: "super_grok_pro",
      status: "active",
      expiresAt: 1000,
      cancelAtPeriodEnd: false,
    });
    expect(next.updatedAt).toBe(50);
  });

  it("snapshot falls back to persisted membership when usage cache is empty", () => {
    const snapshot = buildAccountsSnapshot({
      lastLoginError: null,
      loginDeviceInfo: null,
      loginMode: null,
      loginPending: false,
      loginStartedAt: null,
      now: 10,
      revision: 1,
      state: {
        accounts: [
          record({
            subscription: {
              planType: "super_grok_pro",
              status: "active",
              expiresAt: 2000,
            },
          }),
        ],
        activeAccountId: "acc-1",
        revision: 1,
        schemaVersion: 1,
      },
      usageCache: {},
    });
    expect(snapshot.accounts[0]?.subscription).toEqual({
      planType: "super_grok_pro",
      status: "active",
      expiresAt: 2000,
    });
  });

  it("live usage cache membership wins over persisted membership", () => {
    const snapshot = buildAccountsSnapshot({
      lastLoginError: null,
      loginDeviceInfo: null,
      loginMode: null,
      loginPending: false,
      loginStartedAt: null,
      now: 10,
      revision: 1,
      state: {
        accounts: [
          record({
            subscription: {
              planType: "pro",
              status: "active",
              expiresAt: 1000,
            },
          }),
        ],
        activeAccountId: "acc-1",
        revision: 1,
        schemaVersion: 1,
      },
      usageCache: {
        "acc-1": {
          fetchedAt: 9,
          status: "ok",
          windows: [],
          subscription: {
            planType: "super_grok_pro",
            status: "active",
            expiresAt: 3000,
          },
        },
      },
    });
    expect(snapshot.accounts[0]?.subscription?.planType).toBe("super_grok_pro");
    expect(snapshot.accounts[0]?.subscription?.expiresAt).toBe(3000);
  });
});
