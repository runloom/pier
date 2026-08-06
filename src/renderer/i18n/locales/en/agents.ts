export const agents = {
  focusEmpty: "Nothing needs your attention",
  focusFailed: "Couldn't focus agent — try again",
  focusPanelGone: "Panel closed",
  focusWindowGone: "Window closed",
  indexListFailed: "Couldn't load agent list — try again",
  notificationPermissionDenied: "Notifications off",
  notificationPermissionDeniedDetail:
    "Agent alerts won't appear. Check the agent list, or enable notifications in system settings",
  notificationUnsupported: "Notifications unsupported",
  notificationUnsupportedDetail:
    "System alerts unavailable. Check status in the agent list",
  quickPick: {
    empty: "No running agents",
    emptyDetail: "Start an agent to see it here",
    emptyNew: "Start default agent",
    emptyNewDetail: "No running agents right now",
    focusNextNeedsYou: "Jump to next needing attention",
    placeholder: "Search agents…",
    thisWindow: "This window",
    title: "Agents",
    windowLabel: "Window {{id}}",
  },
  section: {
    needsYou: "Needs attention",
    readyHint: "Awaiting input",
    running: "Running",
  },
  titleBar: {
    countsAria: "Agents: {{needsYou}} need attention, {{running}} running",
  },
} as const;
