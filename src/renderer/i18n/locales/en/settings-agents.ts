export const settingsAgents = {
  permissionMode: {
    yolo: "Skip prompts",
    manual: "Manual",
    mixed: "Mixed",
  },
  defaultPick: {
    auto: "Auto",
    blank: "Blank terminal",
  },
  list: {
    title: "Agent CLIs",
    description: "Installed and detected agents",
    refresh: "Refresh",
    refreshSuccess: "List refreshed",
    refreshFailed: "Couldn't refresh list",
  },
  status: {
    detected: "Detected",
    missing: "Not installed",
    disabled: "Disabled",
  },
  action: {
    enable: "Enable",
    disable: "Disable",
    setDefault: "Set default",
    isDefault: "Default",
    expand: "Details",
    website: "Website",
    websiteOpenBusy: "Another link is already opening",
    websiteOpenFailedDescription: "The agent website could not be opened.",
    websiteOpenFailedTitle: "Unable to open website",
  },
  row: {
    launchCmd: "Launch command",
    detectCmd: "Detect command",
    expectedProcess: "Process",
    commandOverride: "Command override",
    commandOverrideDesc: "Override the agent binary path",
    args: "Launch args",
    argsDesc: "Args appended to the launch command",
    env: "Launch environment",
    envDesc: "Environment variables applied to this agent",
  },
  sessionTitleRefine: {
    label: "Name sessions automatically",
    description:
      "After the first exchange, rewrite the tab title into a closer task name. When off, sessions are still named from your first message — no agent is called and no quota is spent.",
    failed: "Could not update session naming",
  },
  statusHooks: {
    label: "Agent status alerts",
    description:
      "Show live agent run or wait status in panels. Turning this off removes Pier’s status reporting and “Needs you” system notifications. Multiple Pier versions share one on-device hook runtime (newer wins); quitting the app does not uninstall hooks. If Codex asks to review hooks, choose Trust all and continue — usually once is enough.",
    failed: "Could not update agent status alerts",
  },
} as const;
