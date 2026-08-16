/** Language-service rows under `settings.row.*` (file-size isolation). */
export const settingsLspRow = {
  lspHostSectionTitle: "Language services (host)",
  lspHostSectionDesc:
    "Whether Pier starts language-server processes. Language recognition and highlighting are built in; servers run from tools on your PATH. If a tool is missing, open a matching file — the editor status chip shows the install command. “Editor language features” above only controls whether the Files editor uses these services.",
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
  lspUpdateFailed: "Couldn't update language service settings — try again",
  lspWorktreesEnabled: "Run in worktrees",
  lspWorktreesEnabledDesc:
    "Start language servers in agent worktrees too. Extra worktrees use more resources.",
  lspAdvancedTitle: "Resources and limits",
  lspAdvancedDesc: "Defaults are fine for most setups.",
  lspToolsTitle: "Local tools",
  lspToolsDesc:
    "Read-only check of language servers on this machine. Install missing tools yourself (PATH); Pier does not download them.",
  lspToolsLoading: "Checking local tools…",
  lspToolsEmpty: "Could not load tool status",
  lspToolsEmptyDesc:
    "Try again in a moment, or restart Pier and reopen this page.",
  lspToolsNone: "No local tools to list",
  lspToolsNoneDesc: "Nothing is available to check right now.",
  lspToolsStatusBundled: "Built-in",
  lspToolsStatusAvailable: "On PATH",
  lspToolsStatusMissing: "Not found",
  lspToolsCopyInstall: "Copy install command for {{name}}",
  lspToolsCopied: "Copied",
  lspToolsCopyFailed: "Couldn't copy the install command",
} as const;
