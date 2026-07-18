import { describe, expect, it } from "vitest";
import {
  applyLivePlanType,
  buildAccountRecord,
  mergeIdentityIntoAccount,
} from "../../../packages/plugin-codex/src/main/accounts-records.ts";
import type { CodexAccountRecord } from "../../../packages/plugin-codex/src/main/state.ts";

const baseAccount: CodexAccountRecord = {
  createdAt: 1,
  email: "legacy@example.com",
  id: "account-1",
  planType: "pro",
  provider: "codex",
  providerAccountId: "provider-1",
  subscriptionExpiresAt: Date.parse("2026-08-10T14:03:28+00:00"),
  updatedAt: 1,
};

describe("mergeIdentityIntoAccount", () => {
  it("overwrites plan and clears paid expiry when identity downgrades to free", () => {
    const merged = mergeIdentityIntoAccount(
      baseAccount,
      {
        email: "legacy@example.com",
        planType: "free",
        providerAccountId: "provider-1",
      },
      100
    );

    expect(merged).toMatchObject({
      email: "legacy@example.com",
      planType: "free",
      providerAccountId: "provider-1",
      updatedAt: 100,
    });
    expect(merged.subscriptionExpiresAt).toBeUndefined();
  });

  it("keeps previous plan when identity omits plan claims", () => {
    const merged = mergeIdentityIntoAccount(
      baseAccount,
      {
        email: "legacy@example.com",
        providerAccountId: "provider-1",
      },
      100
    );

    expect(merged.planType).toBe("pro");
    expect(merged.subscriptionExpiresAt).toBe(
      baseAccount.subscriptionExpiresAt
    );
    expect(merged.providerAccountId).toBe("provider-1");
  });
});

describe("buildAccountRecord", () => {
  it("omits paid subscription fields for free identity", () => {
    expect(
      buildAccountRecord(
        {
          email: "free@example.com",
          planType: "free",
          providerAccountId: "provider-free",
        },
        "account-free",
        50
      )
    ).toEqual({
      createdAt: 50,
      email: "free@example.com",
      id: "account-free",
      planType: "free",
      provider: "codex",
      providerAccountId: "provider-free",
      updatedAt: 50,
    });
  });
});

describe("applyLivePlanType", () => {
  it("overrides stale pro with free and clears paid expiry", () => {
    const next = applyLivePlanType(baseAccount, "free", 200);
    expect(next.planType).toBe("free");
    expect(next.subscriptionExpiresAt).toBeUndefined();
    expect(next.updatedAt).toBe(200);
  });

  it("returns the same reference when plan is unchanged", () => {
    const paid = applyLivePlanType(baseAccount, "pro", 200);
    expect(paid).toBe(baseAccount);
  });

  it("clears previous expiry when live paid plan changes", () => {
    const next = applyLivePlanType(baseAccount, "plus", 200);
    expect(next.planType).toBe("plus");
    expect(next.subscriptionExpiresAt).toBeUndefined();
    expect(next.updatedAt).toBe(200);
  });
});
