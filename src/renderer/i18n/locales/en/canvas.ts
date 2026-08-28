export const canvas = {
  file: {
    conflict: "{{name}} changed on disk. Reload it before saving again.",
    invalidName: "A canvas may only use files in its own folder.",
    readFailed: "Couldn’t read {{name}} — it isn’t a text file.",
    unavailable: "This canvas isn’t opened from a file, so it can’t save.",
    writeFailed: "Couldn’t save {{name}}.",
  },
  command: {
    cancelLabel: "Cancel",
    confirmBody: "This canvas wants to run:\n\n{{command}}",
    confirmLabel: "Run",
    confirmTitle: "Run this command?",
    failed: "Couldn’t run that command.",
    unavailable:
      "This canvas isn’t opened from a file, so it can’t run commands.",
  },
  blocks: {
    activityEmpty: "No activity in this window",
    activityEmptyHint: "Start an agent, or run a command in a terminal.",
    activityNeedsYou: "Needs your attention",
    activityRunning: "Running",
    activityInProgress: "In progress",
    resourcesEmpty: "No resource data yet",
    resourcesEmptyHint:
      "Pier starts sampling this machine while this canvas is open.",
    resourcesError: "Couldn’t read resources",
    resourcesCpu: "Related CPU",
    resourcesMemory: "Related memory",
    resourcesTerminals: "Terminals",
    costEmpty: "No cost data yet",
    costEmptyHint: "Totals appear after you use a supported AI CLI.",
    costError: "Couldn’t read cost",
    costPeriod: "Cost · last {{count}} days",
    costTokens: "Tokens · last {{count}} days",
  },
} as const;
