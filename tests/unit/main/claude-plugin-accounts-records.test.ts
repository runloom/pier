import { describe, expect, it } from "vitest";
import {
  accountLabel,
  buildAccountRecord,
  mergeIdentityIntoAccount,
} from "../../../packages/plugin-claude/src/main/accounts-records.ts";
import type { AccountIdentity } from "../../../packages/plugin-claude/src/main/identity.ts";

const identity: AccountIdentity = {
  email: "user@example.com",
  organizationName: "Acme",
  providerAccountId: "uuid-1",
  subscriptionType: "pro",
};

describe("Claude accounts records", () => {
  it("builds and labels records from identity", () => {
    const record = buildAccountRecord(identity, "acc-1", 1000);
    expect(record).toMatchObject({
      email: "user@example.com",
      id: "acc-1",
      organizationName: "Acme",
      provider: "claude",
      providerAccountId: "uuid-1",
      subscriptionType: "pro",
      updatedAt: 1000,
    });
    expect(accountLabel(record)).toBe("user@example.com");
    expect(accountLabel({ ...record, email: undefined })).toBe("acc-1");
  });

  it("merges identity and drops stale org/subscription fields", () => {
    const previous = buildAccountRecord(identity, "acc-1", 1000);
    const next = mergeIdentityIntoAccount(
      previous,
      {
        email: "next@example.com",
        providerAccountId: "uuid-2",
      },
      2000
    );
    expect(next).toMatchObject({
      email: "next@example.com",
      id: "acc-1",
      providerAccountId: "uuid-2",
      updatedAt: 2000,
    });
    expect(next.organizationName).toBeUndefined();
    expect(next.subscriptionType).toBeUndefined();
  });
});
