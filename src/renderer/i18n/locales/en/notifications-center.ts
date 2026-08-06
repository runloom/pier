export const notificationsCenter = {
  action: {
    goToAgent: "Handle now",
    openAgent: "Open conversation",
    viewAgentOutput: "View output",
  },
  actionFailed: "Couldn't update notifications",
  bell: {
    aria: "Notifications, {{count}} unread",
    ariaEmpty: "Notifications",
  },
  dnd: {
    off: "Turn off Do Not Disturb",
    on: "Do Not Disturb",
  },
  empty: "No notifications",
  emptyDetail: "System messages will appear here",
  header: {
    markAllRead: "Mark all as read",
    title: "Notifications",
    unread: "{{count}} unread",
  },
  loadMore: "Scroll for more…",
  repeat: "×{{count}}",
  shellEnv: {
    failedBody:
      "Tasks and agents may use a different Node or PATH than your terminal. Open Settings → Terminal to check status, or make sure your shell starts cleanly without prompts.",
    failedTitle: "Couldn't load shell environment",
    openSettings: "Open Terminal settings",
  },
  source: {
    pluginDetail: "Plugin {{source}}",
    agent: "Agent",
    plugin: "Plugin",
    system: "System",
    task: "Task",
  },
} as const;
