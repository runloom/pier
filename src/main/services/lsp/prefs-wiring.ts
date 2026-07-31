/**
 * Wire preferences.lsp changes to the LSP IPC policy.
 * Imported by the LSP IPC module (not command-router) to avoid circular deps.
 */
import type { LspPolicyPrefs } from "@shared/contracts/lsp.ts";
import type { WorkspaceLspPolicy } from "./workspace-policy.ts";

export function applyLspPrefsToPolicy(
  policy: WorkspaceLspPolicy,
  prefs: LspPolicyPrefs
): void {
  policy.setPrefs({
    enabled: prefs.enabled,
    idleReleaseMs: prefs.idleReleaseMs,
    maxLocalWorkspaces: prefs.maxLocalWorkspaces,
    maxRemoteWorkspaces: prefs.maxRemoteWorkspaces,
    worktreesEnabled: prefs.worktreesEnabled,
  });
}
