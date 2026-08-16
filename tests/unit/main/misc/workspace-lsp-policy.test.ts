import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveLspWorkspaceKey,
  WorkspaceLspPolicy,
} from "../../../../src/main/services/lsp/workspace-policy.ts";

describe("WorkspaceLspPolicy", () => {
  const policies: WorkspaceLspPolicy[] = [];

  afterEach(() => {
    for (const policy of policies) {
      policy.dispose();
    }
    policies.length = 0;
  });

  function create(prefs?: ConstructorParameters<typeof WorkspaceLspPolicy>[0]) {
    const policy = new WorkspaceLspPolicy({
      startIdleTimer: false,
      ...prefs,
    });
    policies.push(policy);
    return policy;
  }

  it("derives stable workspace keys", () => {
    expect(deriveLspWorkspaceKey({ rootPath: "/repo/" })).toBe("main:/repo");
    expect(deriveLspWorkspaceKey({ isWorktree: true, rootPath: "/wt/a" })).toBe(
      "wt:/wt/a"
    );
    expect(
      deriveLspWorkspaceKey({
        rootPath: "/x",
        workspaceKey: "custom:key",
      })
    ).toBe("custom:key");
  });

  it("denies when globally disabled", () => {
    const policy = create({ prefs: { enabled: false } });
    const decision = policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/repo",
      workspaceKey: "main:/repo",
    });
    expect(decision).toMatchObject({
      kind: "deny",
      reason: "globally-disabled",
    });
  });

  it("uses the global preference as the sole worktree enablement control", () => {
    const policy = create({ prefs: { worktreesEnabled: false } });
    const denied = policy.acquire({
      isWorktree: true,
      kind: "local",
      rootPath: "/wt",
      workspaceKey: "wt:/wt",
    });
    expect(denied).toMatchObject({
      kind: "deny",
      reason: "worktrees-disabled",
    });

    policy.setPrefs({ worktreesEnabled: true });
    const allowed = policy.acquire({
      isWorktree: true,
      kind: "local",
      rootPath: "/wt",
      workspaceKey: "wt:/wt",
    });
    expect(allowed.kind).toBe("allow");
  });

  it("allows worktrees by default", () => {
    const policy = create();
    const allowed = policy.acquire({
      isWorktree: true,
      kind: "local",
      rootPath: "/wt",
      workspaceKey: "wt:/wt",
    });
    expect(allowed.kind).toBe("allow");
  });

  it("evicts LRU idle workspace when over local limit", () => {
    let now = 1000;
    const policy = create({
      now: () => now,
      prefs: { maxLocalWorkspaces: 1 },
    });

    const first = policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/a",
      workspaceKey: "main:/a",
    });
    expect(first.kind).toBe("allow");
    policy.release("main:/a");
    policy.bindSession("main:/a", "s1");
    now = 2000;

    const second = policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/b",
      workspaceKey: "main:/b",
    });
    expect(second).toMatchObject({
      kind: "allow",
      evictWorkspaceKey: "main:/a",
    });
  });

  it("does not evict workspace with open refs", () => {
    const policy = create({ prefs: { maxLocalWorkspaces: 1 } });
    policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/a",
      workspaceKey: "main:/a",
    });
    // still refCount=1, no release
    const second = policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/b",
      workspaceKey: "main:/b",
    });
    expect(second).toMatchObject({
      kind: "deny",
      reason: "limit-reached",
    });
  });

  it("reaps idle workspaces without open refs", () => {
    let now = 0;
    const policy = create({
      now: () => now,
      prefs: { idleReleaseMs: 1000 },
    });
    policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/a",
      workspaceKey: "main:/a",
    });
    policy.release("main:/a");
    policy.bindSession("main:/a", "s1");
    now = 2000;
    expect(policy.reapIdleWorkspaceKeys()).toEqual(["main:/a"]);
  });

  it("skips idle reap while an agent is busy", () => {
    let now = 0;
    const policy = create({
      now: () => now,
      prefs: { idleReleaseMs: 100 },
    });
    policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/a",
      workspaceKey: "main:/a",
    });
    policy.bindSession("main:/a", "s1");
    policy.release("main:/a");
    policy.markAgentBusy("main:/a", true);
    now = 1000;
    expect(policy.reapIdleWorkspaceKeys()).toEqual([]);

    policy.markAgentBusy("main:/a", false);
    now = 61_000;
    expect(policy.reapIdleWorkspaceKeys()).toEqual(["main:/a"]);
  });
  it("settles cleanup waiters only when the retained tree is terminal", async () => {
    const policy = create();
    const workspaceKey = "main:/repo";
    policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/repo",
      workspaceKey,
    });
    policy.bindSession(workspaceKey, "lsp-1");
    policy.markTreeDraining(workspaceKey, "lsp-1");
    const waiting = policy.waitForTreeCleanup(workspaceKey);
    let settled = false;
    waiting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    policy.markTreeTerminal("lsp-1");

    await expect(waiting).resolves.toBe(true);
  });

  it("rejects cleanup waiters when a retained tree cannot terminate", async () => {
    const policy = create();
    const workspaceKey = "main:/repo";
    policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/repo",
      workspaceKey,
    });
    policy.bindSession(workspaceKey, "lsp-1");
    policy.markTreeDraining(workspaceKey, "lsp-1");
    const waiting = policy.waitForTreeCleanup(workspaceKey);

    policy.markTreeCleanupFailed("lsp-1");

    await expect(waiting).resolves.toBe(false);
    await expect(policy.waitForTreeCleanup(workspaceKey)).resolves.toBe(false);
  });

  it("times out waitForTreeCleanup so ensure cannot hang forever", async () => {
    vi.useFakeTimers();
    try {
      const policy = create();
      const workspaceKey = "main:/repo";
      policy.acquire({
        isWorktree: false,
        kind: "local",
        rootPath: "/repo",
        workspaceKey,
      });
      policy.bindSession(workspaceKey, "lsp-1");
      policy.markTreeDraining(workspaceKey, "lsp-1");
      const waiting = policy.waitForTreeCleanup(workspaceKey, 1000);
      const race = Promise.race([
        waiting.then((value) => ({ value })),
        Promise.resolve().then(() => ({ value: "pending" as const })),
      ]);
      await expect(race).resolves.toEqual({ value: "pending" });
      await vi.advanceTimersByTimeAsync(1000);
      await expect(waiting).resolves.toBe(false);
      await expect(policy.waitForTreeCleanup(workspaceKey)).resolves.toBe(
        false
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
