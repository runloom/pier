export const notificationsCenter = {
  action: {
    goToAgent: "Go to agent",
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
  source: {
    pluginDetail: "Plugin {{source}}",
    agent: "Agent",
    plugin: "Plugin",
    system: "System",
    task: "Task",
  },
} as const;
