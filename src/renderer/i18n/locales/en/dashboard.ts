export const dashboard = {
  addWidget: "Add Widget",
  empty: "Your dashboard is empty",
  emptyDescription:
    "Add widgets to monitor activity and manage your workspace.",
  panelTitle: "Dashboard",
  panelTitleShort: "Dashboard",
  picker: {
    coreSection: "Core",
    pluginSection: "Plugins",
  },
  widget: {
    activityOverview: {
      description: "Live panel and session metrics",
      empty: "No active panels",
      emptyHint: "Panels show up here once a terminal or view is active",
      kind: {
        agent: "Agent",
        idle: "Idle",
        shell: "Terminal",
        task: "Task",
      },
      running: "Running",
      title: "Activity Overview",
      total: "Total",
      waiting: "Waiting",
    },
    loading: "Loading\u2026",
    pluginDisabled: "Plugin disabled",
    remove: "Remove",
    unknown: "Widget unavailable (plugin uninstalled)",
  },
} as const;
