export const workspace = {
  closeFailure: {
    starting:
      "The workspace is still starting, so its layout could not be saved yet.",
    title: "Unable to close window",
    unavailable:
      "The workspace is unavailable, so its layout could not be saved safely.",
  },
  pluginPanel: {
    loadingDescription: "Plugin is loading. Content will appear when ready.",
    loadingTitle: "Loading plugin panel",
    missingRendererDescription: "This plugin has no displayable UI.",
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
    activeTask: "Task running",
    close: "Close tab",
    create: "New",
    hiddenTabs: "Hidden tabs",
    maximize: "Maximize",
    restore: "Restore",
    unsaved: "Unsaved changes",
  },
  addPanelMenu: {
    actionFailed: "Couldn't complete action — try again",
    detectAgentsFailed: "Couldn't detect agents — try again",
    noMatches: "No matching items",
    searchPlaceholder: "Search panel types or agents…",
    title: "Create in this panel group",
    startAgentFailed: "Couldn't start agent — try again",
    startAgentInjectFailed:
      "The terminal opened, but the start command could not be typed. Type it in the terminal, or start the agent again.",
  },
  panelTransfer: {
    dropFailedTitle: "Couldn't move the tab",
    dropFailedBody:
      "Couldn't move to that window. The original tab is still open.",
    dropFailedUnknownComponentBody:
      "Couldn't move to the other window. The original tab is still open.",
    copyToNewWindowFailed: "Couldn't copy into a new window — try again",
    copyToWindowFailed: "Couldn't copy into that window — try again",
    moveToNewWindowFailed: "Couldn't open in a new window — try again",
    moveToWindowFailed: "Couldn't move into that window — try again",
    emptyWindowDescription: "Empty window",
    noOtherWindows: "Open another window first, then try again.",
    pickWindowFailed: "Couldn't list windows — try again",
    pickWindowPlaceholder: "Search windows…",
    pickWindowTitle: "Choose a Window",
    sameNameIndex: " · {{n}}",
    tabCount: "{{count}} tabs",
    windowLabel: "Window {{n}}",
    unsupportedTitle: "This tab can’t be moved to another window",
    unsupportedBody:
      "This tab type can’t move between windows. It’s still open here.",
    unavailableSourceTitle: "Tab no longer available here",
    unavailableSourceBody:
      "Moved elsewhere, but the original couldn’t be closed. Close it manually if needed.",
    unavailableTargetTitle: "Tab couldn’t be restored",
    unavailableTargetBody:
      "The tab was moved to this window, but its source isn’t available here. Re-enable the related extension and reload to restore it.",
  },
} as const;
