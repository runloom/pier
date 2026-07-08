export const terminal = {
  agentStatus: {
    error: "Error",
    processing: "Thinking",
    ready: "Awaiting input",
    subagentCount: "{{count}} agents",
    subagentCount_one: "{{count}} agent",
    subagentCount_other: "{{count}} agents",
    tool: "Running tool",
    waiting: "Awaiting confirmation",
  },
  taskStatus: {
    failed: "{{count}} failed",
    failed_one: "{{count}} failed",
    failed_other: "{{count}} failed",
    idle: "Tasks",
    inputsUnsupported:
      "This task requires input, which is not supported from the status task menu yet",
    loading: "Loading tasks...",
    loadFailed: "Failed to load tasks",
    noTasks: "No runnable tasks found",
    openInNewTab: "Open in new tab",
    rerunInBackground: "Rerun in background",
    running: "{{count}} running",
    running_one: "{{count}} running",
    running_other: "{{count}} running",
    startFailed: "Failed to start task",
    unsupported: "Task unsupported",
  },
  search: {
    close: "Close search",
    label: "Find in terminal",
    matchCount: "{{index}} / {{total}}",
    next: "Next match",
    noMatches: "No matches",
    placeholder: "Find",
    previous: "Previous match",
  },
  statusBar: {
    item: {
      agentStatus: {
        title: "Agent status",
      },
      taskStatus: {
        title: "Task list",
      },
    },
    manage: "Manage Status Bar…",
  },
} as const;
