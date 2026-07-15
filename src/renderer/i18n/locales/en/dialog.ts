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
    shellFallback: "Shell command",
    singleActivityDetail:
      "{{activity}} is still running.\nQuitting Pier will terminate it.",
    title: "Quit Pier?",
  },
  panelClose: {
    cancel: "Cancel",
    close: "Close Panel",
    multipleActivityDetail:
      "{{activities}} are still running.\nClosing this panel will terminate them.",
    singleActivityDetail:
      "{{activity}} is still running.\nClosing this panel will terminate it.",
    title: "Close panel?",
  },
  cancel: "Cancel",
  close: "Close",
  error: {
    invalid: "Invalid input",
  },
  ok: "OK",
} as const;
