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
    reinstall: "Reinstall",
    uninstall: "Uninstall",
    cancel: "Cancel",
    copyInstallCommand: "Copy install command",
    copyInstallCommandSuccess: "Install command copied",
    copyInstallCommandFailed: "Couldn't copy install command",
    installFailed: "Couldn't install agent",
    updateFailed: "Couldn't update agent",
    reinstallFailed: "Couldn't reinstall agent",
    uninstallFailed: "Couldn't uninstall agent",
    installBusy: "Installing",
    updateBusy: "Updating",
    reinstallBusy: "Reinstalling",
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
    rowReinstallFailed: "Reinstall failed",
    rowUninstallFailed: "Uninstall failed",
    rowUninstallPartial: "Default install removed; others still detected",
    alreadyInstalled: "Already installed",
    conflictConfirmTitle: "Multiple installs found",
    conflictConfirmBody:
      "Only the install currently used by default will be updated. Other locations stay unchanged.",
    conflictConfirmContinue: "Update default",
    reinstallConfirmTitle: "Reinstall this agent?",
    reinstallConfirmBody:
      "Reinstalls “{{name}}” using the official installer. Chat and local settings stay.",
    reinstallConfirmConflictNote:
      "Only the install currently used by default will be refreshed. Other locations stay unchanged.",
    reinstallConfirmContinue: "Reinstall",
    uninstallConfirmTitle: "Uninstall this agent?",
    uninstallConfirmBody:
      "Removes “{{name}}” from this Mac ({{source}}: {{path}}). Chat and local settings stay. A running terminal session may stop.",
    uninstallConfirmBodyNameOnly:
      "Removes “{{name}}” from this Mac. Chat and local settings stay. A running terminal session may stop.",
    /** Appended when probe.isConflict (design §9.3); mirrors update conflict tone. */
    uninstallConfirmConflictNote:
      "Only the install currently used by default will be removed. Other locations stay unchanged.",
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
    reinstallHint: "Reinstall to refresh the current install.",
    errors: {
      unsupported:
        "This agent can't be installed automatically. Use the install guide or open the website.",
      unavailable:
        "Install service isn't available right now. Try again later.",
      no_command:
        "No install command is configured for this agent on your system.",
      command_failed:
        "The install, update, or uninstall command failed. See details below.",
      version_unchanged:
        "The version didn't change. Another install may still be in use.",
      not_runnable:
        "Installed, but it wouldn’t start. Run the command in a terminal to see why.",
      not_found_after_install:
        "Install finished, but the command still wasn't found. Refresh the list or open a new terminal.",
      already_installed: "This agent is already installed.",
      busy: "An install, update, or uninstall for this agent is already running.",
      cancelled: "Install, update, or uninstall was cancelled.",
      timeout:
        "Install, update, or uninstall timed out. Try again when the network is stable.",
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
    commandOverrideDesc: "Custom executable path for this agent",
    args: "Launch args",
    argsDesc: "Args appended to the launch command",
    installCommand: "Install command",
    installCommandDesc:
      "Shell command for one-click install. Leave empty for Pier’s default.",
    installCommandPlaceholder: "Leave empty for Pier’s default install steps",
    updateCommand: "Update command",
    updateCommandDesc:
      "Shell command for one-click update. Leave empty for Pier’s default.",
    updateCommandPlaceholder: "Leave empty for Pier’s default update steps",
    uninstallCommand: "Uninstall command",
    uninstallCommandDesc:
      "Shell command for one-click uninstall. Leave empty for Pier’s default.",
    uninstallCommandPlaceholder:
      "Leave empty for Pier’s default uninstall steps",
    env: "Extra environment variables",
    envDesc: "Variables added when launching this agent",
  },
  sessionTitleRefine: {
    label: "Name sessions automatically",
    description:
      "After the first reply, rename the tab to match the task. When off, the first message is used as the name.",
    failed: "Could not update session naming",
  },
  statusHooks: {
    label: "Agent status alerts",
    description:
      "Show run/wait status in panels and send attention alerts. Turn off to silence both.",
    failed: "Could not update agent status alerts",
  },
} as const;
