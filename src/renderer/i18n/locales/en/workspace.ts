export const workspace = {
  closeFailure: {
    starting:
      "The workspace is still starting, so its layout could not be saved yet.",
    title: "Unable to close window",
    unavailable:
      "The workspace is unavailable, so its layout could not be saved safely.",
  },
  pluginPanel: {
    loadingDescription:
      "The plugin is still loading. This panel will appear here when it is ready.",
    loadingTitle: "Loading plugin panel",
    missingRendererDescription:
      "This plugin does not provide a displayable panel UI.",
    unavailableTitle: "Plugin panel unavailable",
  },
  startupError: {
    description: "Reload to try again.",
    retry: "Reload",
    title: "Pier failed to start",
  },
  runtimeError: {
    description: "Terminal sessions are preserved. Reload to continue.",
    retry: "Reload",
    title: "Interface error",
  },
  tab: {
    unsaved: "Unsaved changes",
  },
  addPanelMenu: {
    actionFailed: "Couldn’t complete action",
    detectAgentsFailed: "Couldn’t detect agents",
    noMatches: "No matching items",
    searchPlaceholder: "Search panel types or agents…",
    title: "Create in this panel group",
    trigger: "Create in this panel group",
    startAgentFailed: "Couldn’t start agent",
  },
  panelTransfer: {
    dropFailedTitle: "Couldn’t move the tab",
    dropFailedBody:
      "The tab couldn’t be moved to that window. The original tab is still open.",
    dropFailedUnknownComponentBody:
      "That tab couldn’t be moved to the other window. The original tab is still open.",
    unsupportedTitle: "This tab can’t be moved to another window",
    unsupportedBody:
      "This kind of tab doesn’t support cross-window moves. It’s still open in its original window.",
    unavailableSourceTitle: "Tab no longer available here",
    unavailableSourceBody:
      "The tab was moved to another window, but the original couldn’t be removed from this window. Close it manually if needed.",
    unavailableTargetTitle: "Tab couldn’t be restored",
    unavailableTargetBody:
      "The tab was moved to this window, but its source isn’t available here. Re-enable the related extension and reload to restore it.",
  },
} as const;
