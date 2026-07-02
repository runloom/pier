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
  search: {
    close: "Close search",
    label: "Find in terminal",
    matchCount: "{{index}} / {{total}}",
    next: "Next match",
    noMatches: "No matches",
    placeholder: "Find",
    previous: "Previous match",
  },
} as const;
