/** Settings → Terminal card for installing the packaged `pier` command. */
export const settingsCliCommand = {
  title: "pier command",
  description:
    "Install so you can run pier in Terminal to control this Pier window.",
  statusLabel: "Status:",
  status: {
    installed: "Installed at {{path}}",
    notInstalled: "Not installed",
    loading: "Checking…",
  },
  reason: {
    dev: "Development builds don't add the pier command. From the Pier repo, run pnpm --silent cli:dev -- …",
    unsupported: "This system doesn’t support installing the pier command yet.",
    missingSource: "This Pier build is missing the pier command files.",
    conflict:
      "Another pier already exists at {{path}}. Remove it, then try again.",
    needsAdmin: "macOS will ask for your password to add pier at {{path}}.",
  },
  install: "Install pier command",
  installing: "Installing…",
  uninstall: "Remove pier command",
  uninstalling: "Removing…",
  installConfirmTitle: "Install the pier command?",
  installConfirmBody:
    "macOS will ask for your password to add pier at {{path}}.",
  uninstallConfirmTitle: "Remove the pier command?",
  uninstallConfirmBody:
    "Removes pier from {{path}}. You can install it again later.",
  installFailed: "Couldn't install the pier command",
  uninstallFailed: "Couldn't remove the pier command",
  statusFailed: "Couldn't read pier command status — try again",
  toastInstalled: "pier command installed",
  toastAlreadyInstalled: "pier command is already installed",
  toastRemoved: "pier command removed",
} as const;
