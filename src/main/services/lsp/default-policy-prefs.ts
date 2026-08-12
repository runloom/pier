import type { LspPolicyPrefs } from "@shared/contracts/lsp.ts";

export const DEFAULT_WORKSPACE_LSP_POLICY_PREFS: LspPolicyPrefs = {
  customServers: [],
  enabled: true,
  idleReleaseMs: 1_800_000,
  maxLocalWorkspaces: 3,
  maxRemoteWorkspaces: 2,
  worktreesEnabled: false,
};
