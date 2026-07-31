import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimLoginAfterTerminalCreate,
  resetClaimLoginDepsForTests,
  setClaimLoginDepsForTests,
  tryClaimLoginSeedOnce,
} from "../../../../src/main/services/pier-resource/claim-login-after-create.ts";
import type { ProcessTableRow } from "../../../../src/main/services/pier-resource/process-table.ts";
import {
  listTerminalResourceSessions,
  resetTerminalResourceRegistryForTests,
} from "../../../../src/main/services/pier-resource/terminal-session-registry.ts";

function row(
  partial: Pick<ProcessTableRow, "pid" | "ppid" | "name"> &
    Partial<ProcessTableRow>
): ProcessTableRow {
  return {
    cpuPercent: 0,
    rssBytes: 1024,
    ...partial,
  };
}

describe("claimLoginAfterTerminalCreate", () => {
  beforeEach(() => {
    resetTerminalResourceRegistryForTests();
    resetClaimLoginDepsForTests();
  });

  afterEach(() => {
    resetClaimLoginDepsForTests();
    resetTerminalResourceRegistryForTests();
  });

  it("binds the single newborn login not already claimed", async () => {
    if (process.platform !== "darwin") {
      // 实现仅在 darwin 认领；非 darwin 直接 null
      const seed = await claimLoginAfterTerminalCreate({
        loginPidsBefore: [],
        panelId: "p1",
        windowId: "1",
      });
      expect(seed).toBeNull();
      return;
    }

    const processes: ProcessTableRow[] = [
      row({ name: "PierDev", pid: 1, ppid: 0 }),
      row({ name: "login", pid: 100, ppid: 1 }),
      row({ name: "zsh", pid: 101, ppid: 100 }),
    ];
    setClaimLoginDepsForTests({
      collectAppPids: () => [1],
      listClaimedSeedPids: () => new Set(),
      listProcessTableSync: () => processes,
      sleep: async () => undefined,
    });

    const seed = await claimLoginAfterTerminalCreate({
      loginPidsBefore: [],
      panelId: "panel-a",
      windowId: "1",
    });
    expect(seed).toBe(100);
    const [session] = listTerminalResourceSessions();
    expect(session).toMatchObject({
      loginPid: 100,
      panelId: "panel-a",
      rootPid: 100,
      seedPid: 100,
      shellPid: 101,
    });
  });

  it("excludes already-claimed logins so concurrent panels do not steal", () => {
    if (process.platform !== "darwin") {
      return;
    }
    const processes: ProcessTableRow[] = [
      row({ name: "PierDev", pid: 1, ppid: 0 }),
      row({ name: "login", pid: 100, ppid: 1 }),
      row({ name: "login", pid: 200, ppid: 1 }),
    ];
    setClaimLoginDepsForTests({
      collectAppPids: () => [1],
      listClaimedSeedPids: () => new Set([100]),
      listProcessTableSync: () => processes,
      sleep: async () => undefined,
    });

    const seed = tryClaimLoginSeedOnce({
      loginPidsBefore: [],
      panelId: "panel-b",
      windowId: "1",
    });
    expect(seed).toBe(200);
  });

  it("does not bind when multiple unclaimed newborns remain", () => {
    if (process.platform !== "darwin") {
      return;
    }
    const processes: ProcessTableRow[] = [
      row({ name: "PierDev", pid: 1, ppid: 0 }),
      row({ name: "login", pid: 100, ppid: 1 }),
      row({ name: "login", pid: 200, ppid: 1 }),
    ];
    setClaimLoginDepsForTests({
      collectAppPids: () => [1],
      listClaimedSeedPids: () => new Set(),
      listProcessTableSync: () => processes,
      sleep: async () => undefined,
    });

    const seed = tryClaimLoginSeedOnce({
      loginPidsBefore: [],
      panelId: "panel-a",
      windowId: "1",
    });
    expect(seed).toBeNull();
    expect(listTerminalResourceSessions()).toHaveLength(0);
  });

  it("retries while multiple newborns then binds when one is claimed", async () => {
    if (process.platform !== "darwin") {
      return;
    }
    const pier = row({ name: "PierDev", pid: 1, ppid: 0 });
    const loginA = row({ name: "login", pid: 100, ppid: 1 });
    const loginB = row({ name: "login", pid: 200, ppid: 1 });
    let attempt = 0;
    const claimed = new Set<number>();
    setClaimLoginDepsForTests({
      collectAppPids: () => [1],
      listClaimedSeedPids: () => claimed,
      listProcessTableSync: () => {
        attempt += 1;
        // 第 2 拍起 100 已被占用 → 只剩 200
        if (attempt >= 2) {
          claimed.add(100);
        }
        return [pier, loginA, loginB];
      },
      sleep: async () => undefined,
    });

    const seed = await claimLoginAfterTerminalCreate({
      loginPidsBefore: [],
      panelId: "panel-b",
      windowId: "1",
    });
    expect(seed).toBe(200);
  });

  it("returns null immediately on non-darwin without sleeping", async () => {
    if (process.platform === "darwin") {
      // 在 darwin 上用 mock 平台无法改 process.platform 只读；改测 sleep 未被调用当已有 seed
      return;
    }
    const sleep = vi.fn(async () => undefined);
    setClaimLoginDepsForTests({
      collectAppPids: () => [1],
      listClaimedSeedPids: () => new Set(),
      listProcessTableSync: () => {
        throw new Error("should not list processes on non-darwin");
      },
      sleep,
    });
    const seed = await claimLoginAfterTerminalCreate({
      loginPidsBefore: [],
      panelId: "p",
      windowId: "1",
    });
    expect(seed).toBeNull();
    expect(sleep).not.toHaveBeenCalled();
  });
});
