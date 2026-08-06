/** Shell environment Terminal settings card (split from settings.ts for file-size). */
export const settingsShellEnvironment = {
  title: "Shell environment",
  description:
    "Pier loads your login shell so tasks and agents find the same tools as Terminal.",
  windowsNote:
    "On Windows, login shell loading is skipped. Commands come from the process environment.",
  statusLabel: "Status:",
  status: {
    resolved: "Matched to terminal",
    failed: "Using basic environment",
    skipped: "Skipped",
    unknown: "Not available yet",
  },
  skipReason: {
    cli: "Launched from a terminal; using the current environment",
    disabled: "Login shell loading is turned off",
    "no-shell": "No usable shell detected",
    windows: "Windows does not resolve a login shell",
  },
  refresh: "Reload",
  refreshing: "Reloading…",
  disabled: "Don't load login shell environment",
  disabledDesc:
    "When on, Pier skips your login shell. Tasks may not find tools such as Node.",
  timeout: "Load timeout (seconds)",
  timeoutDesc: "How long Pier waits for the login shell to finish (1–120).",
  statusFailed: "Couldn't read status — try again",
  refreshFailed: "Reload didn't finish; still using current environment",
  updateFailed: "Couldn't update settings — try again",
} as const;
