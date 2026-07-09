export const dialog = {
  appQuit: {
    activityKind: {
      agent: "agent",
      shell: "terminal",
      task: "task",
    },
    activityListWithOverflow: "{{activities}}, and {{count}} more",
    activityName: "{{label}} ({{kind}})",
    activitySeparator: ", ",
    cancel: "Cancel",
    noActivityDetail:
      "Pier will save the current window layout before quitting.",
    multipleActivityDetail:
      "{{activities}} are still running.\nQuitting Pier will terminate them.",
    quit: "Quit",
    singleActivityDetail:
      "{{activity}} is still running.\nQuitting Pier will terminate it.",
    title: "Quit Pier?",
  },
  cancel: "Cancel",
  error: {
    invalid: "Invalid input",
  },
  ok: "OK",
} as const;
