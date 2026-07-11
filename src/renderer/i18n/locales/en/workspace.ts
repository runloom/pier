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
      "This plugin does not provide a renderer component for the panel.",
    unavailableTitle: "Plugin panel unavailable",
  },
  startupError: {
    description:
      "Pier could not finish core initialization. Retry, and keep the error details below if the problem continues.",
    details: "Error details",
    retry: "Reload",
    title: "Pier failed to start",
  },
  tab: {
    unsaved: "Unsaved changes",
  },
  addPanelMenu: {
    trigger: "Add Panel",
    newMissionControl: "New Mission Control",
    newTerminal: "New Terminal",
    newTask: "New Task",
    newWorktree: "New Worktree",
    agentSection: "Agents",
    noAgentDetected: "No agent detected",
  },
} as const;
