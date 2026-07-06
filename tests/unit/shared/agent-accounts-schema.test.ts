import {
  accountUsageSchema,
  agentAccountProviderSchema,
  agentAccountSchema,
  agentAccountsSnapshotSchema,
  rateLimitWindowSchema,
} from "@shared/contracts/agent-accounts.ts";
import { describe, expect, it } from "vitest";

describe("agent-accounts schema", () => {
  const validAccount = {
    createdAt: 1_720_000_000_000,
    email: "alice@example.com",
    id: "acc-001",
    provider: "codex",
    updatedAt: 1_720_000_000_000,
  };

  it("agentAccountProviderSchema 接受 codex 拒绝未知 provider", () => {
    expect(agentAccountProviderSchema.parse("codex")).toBe("codex");
    expect(() => agentAccountProviderSchema.parse("claude")).toThrow();
  });

  it("agentAccountSchema 接受最小合法对象", () => {
    const result = agentAccountSchema.safeParse(validAccount);
    expect(result.success).toBe(true);
  });

  it("agentAccountSchema 接受含可选字段的完整对象", () => {
    const full = {
      ...validAccount,
      lastAuthenticatedAt: 1_720_000_100_000,
      planType: "pro",
      providerAccountId: "chatgpt-acc-xyz",
    };
    const result = agentAccountSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it("agentAccountSchema 拒绝缺少必填字段", () => {
    const { email: _, ...noEmail } = validAccount;
    expect(agentAccountSchema.safeParse(noEmail).success).toBe(false);
  });

  it("rateLimitWindowSchema 接受合法窗口数据", () => {
    const window = {
      usedPercent: 49,
      resetsAt: 1_783_389_343_000,
      windowMinutes: 10_080,
    };
    expect(rateLimitWindowSchema.safeParse(window).success).toBe(true);
  });

  it("rateLimitWindowSchema 接受仅 usedPercent", () => {
    expect(rateLimitWindowSchema.safeParse({ usedPercent: 0 }).success).toBe(
      true
    );
  });

  it("accountUsageSchema 接受 ok 状态", () => {
    const usage = {
      accountId: "acc-001",
      fetchedAt: 1_720_000_200_000,
      status: "ok",
      session: { usedPercent: 11 },
      weekly: { usedPercent: 49 },
    };
    expect(accountUsageSchema.safeParse(usage).success).toBe(true);
  });

  it("accountUsageSchema 接受 error 状态", () => {
    const usage = {
      accountId: "acc-001",
      error: "RPC timeout",
      fetchedAt: 1_720_000_200_000,
      status: "error",
    };
    expect(accountUsageSchema.safeParse(usage).success).toBe(true);
  });

  it("agentAccountsSnapshotSchema round-trip", () => {
    const snapshot = {
      accounts: [validAccount],
      activeAccountId: "acc-001",
      lastLoginError: null,
      loginPending: null,
      ts: 1,
      usage: {},
    };
    const result = agentAccountsSnapshotSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(snapshot);
    }
  });

  it("agentAccountsSnapshotSchema 拒绝无效 loginPending provider", () => {
    const snapshot = {
      accounts: [],
      activeAccountId: null,
      lastLoginError: null,
      loginPending: "unsupported",
      ts: 1,
      usage: {},
    };
    expect(agentAccountsSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});
