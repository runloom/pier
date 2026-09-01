/** Language-service rows under `settings.row.*` (file-size isolation). */
export const settingsLspRow = {
  lspHostSectionTitle: "Language services (host)",
  lspHostSectionDesc:
    "Whether Pier starts language-server processes. Language recognition and highlighting are built in. Missing servers are listed below; opening a matching file also shows an install command in the editor status chip. “Editor language features” above only controls whether the Files editor uses these services.",
  lspEnabled: "Run language servers",
  lspEnabledDesc:
    "When off, no completions or diagnostics processes start for any project.",
  lspIdleReleaseMinutes: "Idle release",
  lspIdleReleaseMinutesDesc:
    "Release idle servers after this many minutes; range 1–1440",
  lspMaxLocalWorkspaces: "Local project limit",
  lspMaxLocalWorkspacesDesc:
    "Max local projects with active language servers at once",
  lspMaxRemoteWorkspaces: "Remote project limit",
  lspMaxRemoteWorkspacesDesc:
    "Max remote projects with active language servers at once",
  lspMemoryBudgetMb: "Memory budget",
  lspMemoryBudgetMbDesc:
    "Total memory cap for language servers; the least recently used project is stopped when exceeded and restarts on demand. 0 disables the cap",
  lspUpdateFailed: "Couldn't update language service settings — try again",
  lspWorktreesEnabled: "Run in worktrees",
  lspWorktreesEnabledDesc:
    "Start language servers in agent worktrees too. Extra worktrees use more resources.",
  lspAdvancedTitle: "Resources and limits",
  lspAdvancedDesc: "Defaults are fine for most setups.",
  lspToolsTitle: "Language servers on this computer",
  lspToolsDesc:
    "Completions, go-to-definition, and diagnostics use language servers already on this computer. Install any that are missing; Pier does not download them.",
  lspToolsLoading: "Checking language servers…",
  lspToolsEmpty: "Couldn't check language servers",
  lspToolsEmptyDesc:
    "Try again in a moment, or restart Pier and reopen this page.",
  lspToolsNone: "No language servers to list",
  lspToolsNoneDesc: "Nothing to check right now.",
  lspToolsStatusBundled: "Built-in",
  lspToolsStatusAvailable: "Installed",
  lspToolsStatusMissing: "Not installed",
  lspToolsInstallLabel: "Install",
  lspToolsCopyInstall: "Copy install command for {{name}}",
  lspToolsCopied: "Copied",
  lspToolsCopyFailed: "Couldn't copy the install command",
} as const;
