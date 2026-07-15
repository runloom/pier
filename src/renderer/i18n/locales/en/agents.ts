export const agents = {
  focusEmpty: "No agents need your attention",
  focusFailed: "Could not focus agent",
  focusPanelGone: "Agent panel is gone",
  focusWindowGone: "Agent window is gone",
  indexListFailed: "Could not load agent list",
  notificationPermissionDenied:
    "System notifications unavailable; use Agent List or the jump shortcut when confirmation is needed",
  notificationUnsupported:
    "System notifications unsupported; use Agent List or the jump shortcut when confirmation is needed",
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
    readyHint: "Awaiting input (no notification)",
    running: "Running",
  },
  titleBar: {
    countsAria: "Agents: {{needsYou}} need you, {{running}} running",
  },
} as const;
