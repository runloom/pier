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
} as const;
