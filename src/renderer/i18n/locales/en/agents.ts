export const agents = {
  focusEmpty: "Nothing needs your attention",
  focusFailed: "Couldn't focus agent",
  focusPanelGone: "Panel closed",
  focusWindowGone: "Window closed",
  indexListFailed: "Couldn't load agent list",
  notificationPermissionDenied: "Notifications off",
  notificationPermissionDeniedDetail:
    "Won't get agent alerts; check the list or jump shortcuts",
  notificationUnsupported: "Notifications unsupported",
  notificationUnsupportedDetail:
    "Won't get agent alerts; check the list or jump shortcuts",
  quickPick: {
    empty: "No running agents",
    emptyDetail: "Start an agent to see it here",
    emptyNew: "Start default agent",
    emptyNewDetail: "No running agents right now",
    focusNextNeedsYou: "Jump to next that needs you",
    placeholder: "Search agents…",
    thisWindow: "This window",
    title: "Agents",
    windowLabel: "Window {{id}}",
  },
  section: {
    needsYou: "Needs you",
    readyHint: "Awaiting input",
    running: "Running",
  },
  titleBar: {
    countsAria: "Agents: {{needsYou}} need you, {{running}} running",
  },
} as const;
