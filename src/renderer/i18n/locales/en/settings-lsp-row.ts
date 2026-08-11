/** Language-service rows under `settings.row.*` (file-size isolation). */
export const settingsLspRow = {
  lspHostSectionTitle: "Language services (host)",
  lspHostSectionDesc:
    "Whether Pier starts language-server processes. Optional languages (Zig, Java, C/C++, C#, …) are installable language packs under Plugins. If a tool is missing, open a matching file — the editor status chip shows the install command. The “Editor language features” toggle above only controls whether the Files editor uses these services.",
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
} as const;
