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
    noActivityDetail: "Window layout is saved before quitting.",
    multipleActivityDetail:
      "{{activities}} are still running.\nQuitting will stop them.",
    quit: "Quit",
    shellFallback: "Terminal command",
    singleActivityDetail:
      "{{activity}} is still running.\nQuitting will stop it.",
    title: "Quit Pier?",
  },
  panelClose: {
    cancel: "Cancel",
    close: "Close Panel",
    multipleActivityDetail:
      "{{activities}} are still running.\nClosing this panel will stop them.",
    singleActivityDetail:
      "{{activity}} is still running.\nClosing this panel will stop it.",
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
    copyImage: "Copy image",
    copyImageFailed: "Couldn't copy the image",
    copyImageNotReady:
      "The image is still loading. Wait until it appears, then try copying again.",
    fit: "Fit to window",
    loadFailedDescription: "Couldn't load the image, or it changed after open.",
    loadFailedTitle: "Unable to display image",
    loading: "Loading image",
    imageCopied: "Image copied",
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
