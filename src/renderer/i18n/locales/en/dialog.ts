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
  imagePreview: {
    actualSize: "Actual size",
    controlsLabel: "Image controls",
    fit: "Fit to window",
    loadFailedDescription:
      "The image could not be loaded or changed after it was opened.",
    loadFailedTitle: "Unable to display image",
    loading: "Loading image",
    title: "Image preview",
    viewerLabel: "Image preview",
    zoomIn: "Zoom in",
    zoomLevel: "Zoom level",
    zoomOut: "Zoom out",
  },
  contentPreview: {
    title: "Preview",
  },
  ok: "OK",
} as const;
