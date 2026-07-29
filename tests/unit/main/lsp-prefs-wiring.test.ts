import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLspPrefsToPolicy } from "../../../src/main/services/lsp/lsp-prefs-wiring.ts";
import { WorkspaceLspPolicy } from "../../../src/main/services/lsp/workspace-lsp-policy.ts";
import { DEFAULT_LSP_POLICY_PREFS } from "../../../src/shared/contracts/lsp.ts";

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

  it("applies worktreesEnabled=true to allow worktree", () => {
    const policy = new WorkspaceLspPolicy({ startIdleTimer: false });
    policies.push(policy);
    applyLspPrefsToPolicy(policy, {
      ...DEFAULT_LSP_POLICY_PREFS,
      worktreesEnabled: true,
    });
    const decision = policy.acquire({
      isWorktree: true,
      kind: "local",
      rootPath: "/wt",
      workspaceKey: "wt:/wt",
    });
    expect(decision.kind).toBe("allow");
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

  it("default prefs allow main workspace", () => {
    const policy = new WorkspaceLspPolicy({ startIdleTimer: false });
    policies.push(policy);
    applyLspPrefsToPolicy(policy, DEFAULT_LSP_POLICY_PREFS);
    const decision = policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/repo",
      workspaceKey: "main:/repo",
    });
    expect(decision.kind).toBe("allow");
  });
});
