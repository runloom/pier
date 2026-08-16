import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLspPrefsToPolicy } from "../../../../src/main/services/lsp/prefs-wiring.ts";
import { WorkspaceLspPolicy } from "../../../../src/main/services/lsp/workspace-policy.ts";
import { DEFAULT_LSP_POLICY_PREFS } from "../../../../src/shared/contracts/lsp.ts";

describe("applyLspPrefsToPolicy", () => {
  const policies: WorkspaceLspPolicy[] = [];

  afterEach(() => {
    for (const policy of policies) {
      policy.dispose();
    }
    policies.length = 0;
    vi.restoreAllMocks();
  });

  it("applies enabled=false to deny all", () => {
    const policy = new WorkspaceLspPolicy({ startIdleTimer: false });
    policies.push(policy);
    applyLspPrefsToPolicy(policy, {
      ...DEFAULT_LSP_POLICY_PREFS,
      enabled: false,
    });
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

  it("applies worktreesEnabled=false to deny worktree", () => {
    const policy = new WorkspaceLspPolicy({ startIdleTimer: false });
    policies.push(policy);
    applyLspPrefsToPolicy(policy, {
      ...DEFAULT_LSP_POLICY_PREFS,
      worktreesEnabled: false,
    });
    const decision = policy.acquire({
      isWorktree: true,
      kind: "local",
      rootPath: "/wt",
      workspaceKey: "wt:/wt",
    });
    expect(decision).toMatchObject({
      kind: "deny",
      reason: "worktrees-disabled",
    });
  });

  it("applies maxLocalWorkspaces=0 to deny new workspace", () => {
    const policy = new WorkspaceLspPolicy({ startIdleTimer: false });
    policies.push(policy);
    applyLspPrefsToPolicy(policy, {
      ...DEFAULT_LSP_POLICY_PREFS,
      maxLocalWorkspaces: 0,
    });
    const decision = policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/repo",
      workspaceKey: "main:/repo",
    });
    expect(decision).toMatchObject({
      kind: "deny",
      reason: "limit-reached",
    });
  });

  it("default prefs allow main workspace and worktree", () => {
    const policy = new WorkspaceLspPolicy({ startIdleTimer: false });
    policies.push(policy);
    applyLspPrefsToPolicy(policy, DEFAULT_LSP_POLICY_PREFS);
    const main = policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/repo",
      workspaceKey: "main:/repo",
    });
    expect(main.kind).toBe("allow");
    const worktree = policy.acquire({
      isWorktree: true,
      kind: "local",
      rootPath: "/wt",
      workspaceKey: "wt:/wt",
    });
    expect(worktree.kind).toBe("allow");
  });
});
