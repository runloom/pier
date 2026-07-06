import type { AgentAccountsSnapshot } from "@shared/contracts/agent-accounts.ts";
import { describe, expect, it } from "vitest";
import { useAgentAccountsStore } from "@/stores/agent-accounts.store.ts";

function makeSnapshot(
  ts: number,
  overrides?: Partial<AgentAccountsSnapshot>
): AgentAccountsSnapshot {
  return {
    accounts: [],
    activeAccountId: null,
    lastLoginError: null,
    loginPending: null,
    ts,
    usage: {},
    ...overrides,
  };
}

describe("useAgentAccountsStore", () => {
  it("apply 写入 snapshot", () => {
    const store = useAgentAccountsStore;
    store.setState({ snapshot: null, ts: 0 });
    store.getState().apply(makeSnapshot(1));
    expect(store.getState().snapshot).toEqual(makeSnapshot(1));
    expect(store.getState().ts).toBe(1);
  });

  it("ts 单调守卫拒收乱序广播", () => {
    const store = useAgentAccountsStore;
    store.setState({ snapshot: null, ts: 0 });
    store.getState().apply(makeSnapshot(5));
    store.getState().apply(makeSnapshot(3)); // 乱序——应被拒收
    expect(store.getState().ts).toBe(5);
  });

  it("ts 相等时仍接受（幂等全量推送）", () => {
    const store = useAgentAccountsStore;
    store.setState({ snapshot: null, ts: 0 });
    store.getState().apply(makeSnapshot(2, { activeAccountId: "acc-1" }));
    store.getState().apply(makeSnapshot(2, { activeAccountId: "acc-2" }));
    // 相等 ts 接受最后一次
    expect(store.getState().snapshot?.activeAccountId).toBe("acc-2");
  });
});
