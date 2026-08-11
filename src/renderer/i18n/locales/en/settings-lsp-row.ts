/** Language-service rows under `settings.row.*` (file-size isolation). */
export const settingsLspRow = {
  lspHostSectionTitle: "Language services (host)",
  lspHostSectionDesc:
    "Whether Pier starts language-server processes. Language recognition and highlighting are built in; servers run from tools on your PATH. If a tool is missing, open a matching file — the editor status chip shows the install command. “Editor language features” above only controls whether the Files editor uses these services.",
  lspEnabled: "Run language servers",
  lspEnabledDesc:
    "When off, no completions or diagnostics processes start for any project.",
  lspIdleReleaseMinutes: "Idle release (minutes)",
  lspIdleReleaseMinutesDesc:
    "Release idle servers after this many minutes (1–1440)",
  lspMaxLocalWorkspaces: "Local project limit",
  lspMaxLocalWorkspacesDesc:
    "Max local projects with active language servers at once",
  lspMaxRemoteWorkspaces: "Remote project limit",
  lspMaxRemoteWorkspacesDesc:
    "Max remote projects with active language servers at once",
  lspUpdateFailed: "Couldn't update language service settings — try again",
  lspWorktreesEnabled: "Run in worktrees",
  lspWorktreesEnabledDesc:
    "Agent worktrees are off by default to save resources",
  lspAdvancedTitle: "Resources and limits",
  lspAdvancedDesc: "Defaults are fine for most setups.",
  lspToolsTitle: "Local tools",
  lspToolsDesc:
    "Read-only check of language servers on this machine. Install missing tools yourself (PATH); Pier does not download them.",
  lspToolsLoading: "Checking local tools…",
  lspToolsEmpty: "Could not load tool status.",
  lspToolsStatusBundled: "Built-in",
  lspToolsStatusAvailable: "On PATH",
  lspToolsStatusMissing: "Not found",
  lspToolsInstallHint: "Install: {{command}}",
} as const;
