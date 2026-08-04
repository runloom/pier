/** Shell environment Terminal settings card (split from settings.ts for file-size). */
export const settingsShellEnvironment = {
  title: "Shell environment",
  description:
    "Pier loads your login shell environment so tasks and agents use the same Node and PATH as Terminal.",
  windowsNote:
    "On Windows, login-shell environment resolution is skipped. PATH comes from the process environment.",
  statusLabel: "Status:",
  status: {
    resolved: "Loaded",
    failed: "Failed to load",
    skipped: "Skipped",
    unknown: "Not available yet",
  },
  shellLabel: "Shell: {{shell}}",
  refresh: "Reload shell environment",
  refreshing: "Reloading…",
  disabled: "Disable shell environment loading",
  disabledDesc:
    "When on, Pier does not run your shell to load PATH and toolchains. Tasks may not find Node or other tools installed via nvm or Homebrew.",
  timeout: "Load timeout (seconds)",
  timeoutDesc: "How long Pier waits for your shell to finish starting (1–120).",
  statusFailed: "Couldn't load shell environment status",
  refreshFailed: "Couldn't reload shell environment",
  updateFailed: "Couldn't update shell environment settings",
} as const;
