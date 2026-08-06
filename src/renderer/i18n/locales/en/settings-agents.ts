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
    checkUpdates: "Check for updates",
    checkUpdatesSuccess: "Update check finished",
    checkUpdatesFailed: "Couldn't check for updates",
    updateAll: "Update all",
    updateAllDone: "Finished updating agents",
    updateAllPartial: "Some agents could not be updated",
  },
  status: {
    detected: "Detected",
    missing: "Not installed",
    disabled: "Disabled",
    updateAvailable: "Update available",
    broken: "Installed but won’t run",
    conflict: "Multiple installs",
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
    install: "Install",
    update: "Update",
    uninstall: "Uninstall",
    cancel: "Cancel",
    copyInstallCommand: "Copy install command",
    copyInstallCommandSuccess: "Install command copied",
    copyInstallCommandFailed: "Couldn't copy install command",
    installFailed: "Couldn't install agent",
    updateFailed: "Couldn't update agent",
    uninstallFailed: "Couldn't uninstall agent",
    installBusy: "Installing",
    updateBusy: "Updating",
    uninstallBusy: "Uninstalling",
    queueBusy: "Queued",
    /** Multi-step only: "2/3" */
    busyStep: "{{current}}/{{total}}",
    /** Real tool percent only: "42%" */
    busyPercent: "{{percent}}%",
    rowInstallFailed: "Install failed",
    rowInstallFailedWithStep: "Install failed ({{step}})",
    rowUpdateFailed: "Update failed",
    rowUpdateFailedWithStep: "Update failed ({{step}})",
    rowUninstallFailed: "Uninstall failed",
    rowUninstallPartial: "Default install removed; others still detected",
    alreadyInstalled: "Already installed",
    conflictConfirmTitle: "Multiple installs found",
    conflictConfirmBody:
      "Only the install currently used by default will be updated. Other locations stay unchanged.",
    conflictConfirmContinue: "Update default",
    uninstallConfirmTitle: "Uninstall this agent?",
    uninstallConfirmBody:
      "Removes the “{{name}}” command-line tool from this computer ({{source}}: {{path}}). Chat history and local settings stay. If it is still running in a terminal, that session may stop working.",
    uninstallConfirmContinue: "Uninstall",
    uninstallSuccess: "Uninstalled {{name}}",
    uninstallSkipped: "Not installed",
    uninstallUnsupported:
      "This install method can't be uninstalled automatically. Add a custom command below, or open the website.",
  },
  lifecycle: {
    version: "Version",
    latest: "Latest",
    installGuide: "Install commands",
    installs: "Install locations",
    updateHint: "Update installs the latest version",
    errors: {
      unsupported:
        "This agent can't be installed automatically. Use the install guide or open the website.",
      unavailable:
        "Install service isn't available right now. Try again later.",
      no_command:
        "No install command is configured for this agent on your system.",
      command_failed:
        "The install or update command failed. See details below.",
      version_unchanged:
        "The version didn't change. Another install may still be in use.",
      not_runnable:
        "Installed, but the command couldn't run. Check that required runtimes (for example Node.js) are set up.",
      not_found_after_install:
        "Install finished, but the command still wasn't found. Refresh the list or open a new terminal.",
      already_installed: "This agent is already installed.",
      busy: "An install or update for this agent is already running.",
      cancelled: "Install or update was cancelled.",
      timeout:
        "Install or update timed out. Try again when the network is stable.",
      env_unavailable:
        "Couldn't prepare the shell environment. Refresh and try again.",
      package_manager_missing:
        "A required package manager (npm, Homebrew, pipx, or uv) was not found. Install one, then try again.",
      still_detected: "Uninstall finished, but the agent is still detected.",
    },
  },
  row: {
    launchCmd: "Launch command",
    detectCmd: "Detect command",
    expectedProcess: "Process",
    commandOverride: "Command override",
    commandOverrideDesc: "Override the agent binary path",
    args: "Launch args",
    argsDesc: "Args appended to the launch command",
    installCommand: "Install command",
    installCommandDesc:
      "Shell command for one-click install. Leave empty to use Pier’s default (from official / package-manager channels).",
    installCommandPlaceholder: "Leave empty for Pier’s default install steps",
    updateCommand: "Update command",
    updateCommandDesc:
      "Shell command for one-click update. Leave empty to use Pier’s default (matched to how this CLI was installed).",
    updateCommandPlaceholder: "Leave empty for Pier’s default update steps",
    uninstallCommand: "Uninstall command",
    uninstallCommandDesc:
      "Shell command for one-click uninstall. Leave empty to use Pier’s default (matched to how this CLI was installed).",
    uninstallCommandPlaceholder:
      "Leave empty for Pier’s default uninstall steps",
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
