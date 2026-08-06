export const notificationsCenter = {
  action: {
    goToAgent: "Handle now",
    openAgent: "Open conversation",
    viewAgentOutput: "View output",
  },
  actionFailed: "Couldn't update notifications — try again",
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
      "Tool paths may not match Terminal. Open Settings → Terminal and reload.",
    failedTitle: "Task environment may differ from the terminal",
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
