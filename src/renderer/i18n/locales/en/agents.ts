export const agents = {
  focusEmpty: "Nothing needs your attention",
  focusFailed: "Couldn't focus agent",
  focusPanelGone: "Panel closed",
  focusWindowGone: "Window closed",
  indexListFailed: "Couldn't load agent list",
  notificationPermissionDenied:
    "Notifications off — use Agent List or the jump shortcut",
  notificationUnsupported:
    "Notifications unavailable — use Agent List or the jump shortcut",
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
