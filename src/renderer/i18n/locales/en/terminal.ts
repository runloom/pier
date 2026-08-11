export const terminal = {
  closeFailed: "Couldn't close terminal — try again",
  frameWaitFailed:
    "Terminal view didn't appear. Try again, or reopen this terminal.",
  openPathFailed: "Couldn't open path — try again",
  openPathInvalid: "Couldn't open this path",
  openPathRelativeWithoutCwd:
    "This terminal has no working directory, so the relative path cannot be opened.",
  openPathUnsupportedScheme: "Couldn't open this link in Pier",
  agentSession: {
    coldStart: "Couldn’t resume the previous session. Started a fresh agent.",
    endedBody: "The previous session has exited. Restart to continue.",
    endedTitle: "Agent session ended",
    fieldAgent: "Agent",
    fieldCommand: "Command",
    fieldCwd: "Working directory",
    fieldDuration: "Duration",
    fieldExitCode: "Exit code",
    fieldStatus: "Status",
    restart: "Restart agent",
    restartFailed: "Couldn't restart agent — try again",
    statusEnded: "Ended normally",
    statusFailed: "Failed",
    summaryTitle: "Session summary",
    tryResumeLast: "Resume latest in this folder",
    tryResumeLastFailed:
      "Couldn't resume the latest session in this folder — try again",
    unsupported:
      "This agent can’t resume the previous session. Started a fresh agent.",
  },
  agentStatus: {
    error: "Error",
    processing: "Thinking",
    ready: "Awaiting input",
    /** Launch prior with no hook status and no catalog label. */
    starting: "Starting…",
    subagentCount: "{{count}} sub-agents",
    subagentCount_one: "{{count}} sub-agent",
    subagentCount_other: "{{count}} sub-agents",
    tool: "Running tool",
    waiting: "Awaiting confirmation",
  },
  composer: {
    attachFailed: "Couldn’t add file — try again",
    attachFile: "Add file",
    // Only warn for verified TUIs; cursor risk never disables sending by itself.
    blockedUnfocused: "Terminal input may not be focused",
    blockedUnfocusedBody:
      "Click the session input first, or continue if you’re sure it can accept input.",
    blockedUnfocusedTitle: "Terminal input may not be focused",
    invalidAttachmentRef: "Invalid attachment — remove and add again",
    keyHint: "⇧⏎ newline · {{attach}} attach · Esc close",
    label: "Rich Input",
    largePasteAttachFailed: "Couldn’t attach paste — try again",
    editPasteTitle: "Edit pasted content",
    editPasteLabel: "Content",
    editPasteEmptyHint: "Clearing and saving removes this paste",
    editPasteSave: "Save",
    editPasteSaveFailed: "Couldn’t save pasted content — try again",
    pasteAttachmentAria: "Pasted content, attachment {{n}}",
    attachmentAutocompleteEmptyBody:
      "Add a file first, then type # to insert it here.",
    attachmentAutocompleteEmptyTitle: "No attachments yet",
    attachmentAutocompleteNoResults: "No matching attachments",
    mentionEmptyProjectBody:
      "Open a project folder first to mention files with @.",
    mentionEmptyProjectTitle: "No project open",
    mentionNoResults: "No matching files",
    mentionPlaceholder: "Mention a file or folder…",
    noActiveTerminal:
      "Switch to the target terminal tab first, then open Rich Input.",
    pasteInsertAnyway: "Insert into message anyway",
    pathUnreadable: "Couldn’t read that file — check the path",
    placeholder: "Type here; sends into the terminal session",
    removeAttachment: "Remove attachment",
    send: "Send",
    sendAnyway: "Send anyway",
    sendFailed: "Couldn't send — try again",
    sendTooLong: "Message is too long — shorten and retry",
    skillEmptyProjectBody:
      "Open a project folder first, then type / to insert a skill.",
    skillEmptyProjectTitle: "No project open",
    skillNoAgentBody:
      "Switch to an agent terminal, then type / to insert a skill.",
    skillNoAgentTitle: "No active agent",
    skillNoResults: "No matching skills",
    skillNoneAvailableBody:
      "No skills for this agent. Enable some in Settings → Projects → Skills, or switch agents.",
    skillNoneAvailableTitle: "No skills for this agent",
    skillPlaceholder: "Choose a skill for this agent…",
    skillSourceBundled: "Built-in",
    skillSourceGlobal: "On this Mac",
    skillSourceInRepo: "In project",
    skillSourceProject: "Managed",
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
  runtimeControl: {
    blocked: "Blocked",
    cancelled: "Cancelled",
    close: "Close task panel",
    controlLabel: "Task run controls: {{label}}",
    dismiss: "Close",
    duration: "Elapsed time: {{duration}}",
    failed: "Failed",
    finishedBlocked: "Task blocked",
    finishedCancelled: "Task cancelled",
    finishedDetailDuration: "{{label}} · took {{duration}}",
    finishedDetailFailed: "{{label}} · exit code {{code}} · took {{duration}}",
    finishedDetailRanFor: "{{label}} · ran for {{duration}}",
    finishedDetailBlocked:
      "{{label}} · waiting on dependencies, took {{duration}}",
    finishedFailed: "Task failed",
    finishedForceCancelled: "Task force-stopped",
    finishedStopped: "Task stopped",
    finishedSuccess: "Task finished",
    forceStop: "Force stop",
    forceStopBody:
      "The task didn’t stop cleanly. Force stop ends it now; you can still open the output.",
    forceStopConfirm: "Force stop",
    forceStopTitle: "Force stop task?",
    inputResolutionFailed: "Required inputs are still missing",
    missingRunIdentity:
      "Task started, but status isn’t shown. Run again or open the output.",
    move: "Move run controls",
    openOutput: "Open task output",
    openOutputFailed: "Couldn't open task output — try again",
    pending: "Pending",
    progress: "{{completed}} / {{total}}",
    progressLabel: "{{completed}} of {{total}} tasks completed",
    restart: "Restart task",
    reveal: "Reveal task terminal",
    revealFailed: "Couldn't find task terminal — try again",
    revealUnavailableBody: "The task terminal is no longer available.",
    running: "Running",
    selectRunCurrent: "Switch task, current: {{label}}",
    startFailed: "Couldn't start task — try again",
    stateUnavailableDismiss: "Dismiss",
    stateUnavailableRetry: "Retry",
    stateUnavailableTitle: "Task status unavailable",
    stop: "Stop task",
    stopFailed: "Couldn't stop task — try again",
    stopping: "Stopping",
    succeeded: "Succeeded",
    viewDetails: "View details",
  },
  statusBar: {
    item: {
      agentStatus: {
        title: "Agent status",
      },
      comments: {
        chipLabel: "Comments · {{count}}",
        clear: "Clear",
        clearBody:
          "This removes every comment in this list (changes, documents, and canvases). You can’t undo this.",
        clearConfirm: "Clear",
        clearFailed: "Couldn’t clear comments",
        clearPartialBody:
          "Removed {{deleted}} comment(s). {{remaining}} could not be removed. Try again for the rest.",
        clearPartialTitle: "Some comments remain",
        clearTitle: "Clear all comments?",
        deleteFailed: "Couldn’t delete comment",
        deleteOne: "Delete comment",
        dialogTitle: "Comments",
        empty: "No open comments",
        emptyBody:
          "Add comments on changes, documents, or canvases to handle them here.",
        emptyTitle: "No comments to handle",
        failure: {
          commentNotFound: "That comment is no longer available.",
          internal: "Something went wrong. Try again.",
          invalidSource: "These comments aren’t available for this project.",
          targetImmutable: "That comment can’t be changed.",
          threadNotFound: "That comment thread is no longer available.",
        },
        itemTitle: "{{path}}:{{line}}",
        itemTitlePathOnly: "{{path}}",
        sourceCanvas: "Canvas",
        sourceGit: "diff",
        sourceMarkdown: "Document",
        jumpFailed: "Couldn’t open changes",
        jumpFailedBody:
          "Open the Changes view for this project, then try jumping again.",
        jumpUnsupportedBody:
          "Jumping to this comment type isn’t available yet. You can still submit it to the agent from this list.",
        jumpUnsupportedTitle: "Jump not available yet",
        loadingLabel: "Loading current changes…",
        openCount: "{{count}} open comments",
        staleJumpBody:
          "That file has already been committed or is no longer in the current changes. This comment will be removed.",
        staleJumpTitle: "Comment is no longer on current changes",
        submitAndClear: "Submit and clear",
        submitFailed: "Couldn’t submit comments",
        submitPartialBody:
          "Comments were added to the composer. Removed {{deleted}} from the list; {{remaining}} could not be removed.",
        submitPartialTitle: "Submitted with remaining comments",
        submitUnavailableBody:
          "Open an agent conversation first, then try again.",
        title: "Comments",
      },
    },
    manage: "Manage Status Bar…",
  },
  /**
   * Ghostty / native host messages (see ghostty-host-copy catalog).
   * Prefer product wording over Ghostty brand for user-facing copy.
   */
  ghosttyHost: {
    processExited: "Process exited",
    processExitedFailed: "Process exited with code {{code}}",
    processExitedAbnormal:
      "The command exited too quickly ({{duration}}). It may have failed to start.",
    agentExited: "Agent session ended",
    agentExitedFailed: "Agent session ended with code {{code}}",
    agentExitedAbnormal:
      "The agent exited too quickly ({{duration}}). It may have failed to start.",
    taskExited: "Task finished",
    taskExitedFailed: "Task failed with code {{code}}",
    taskExitedAbnormal:
      "The task exited too quickly ({{duration}}). It may have failed to start.",
    taskOutputExited: "Task output ended",
    taskOutputExitedFailed: "Task output ended with code {{code}}",
    taskOutputExitedAbnormal:
      "Task output ended too quickly ({{duration}}). The process may have failed to start.",
    dismissAnyKey: "Press any key to close",
    dismissExplicit: "Close the tab when you’re done reviewing",
    injectExitFailed:
      "Couldn’t show the session end message in the terminal. Close the tab when you’re done.",
    launchFailedTitle: "Couldn’t start the command",
    launchFailedRuntime: "Runtime: {{duration}}",
    launchFailedExitCode: "Exit code: {{code}}",
    launchFailedDismiss: "Press any key to close",
    ptyExhausted:
      "This Mac can’t open another terminal right now. Close unused terminals or other apps that use terminal sessions, then try again.",
    inputPathFailed:
      "A configured startup input file is missing or unreadable. Check your terminal input settings and try again.",
    ioThreadFailed:
      "Couldn’t start the terminal session ({{error}}). Close this tab and try again.",
    ioThreadOom:
      "Not enough memory to start the terminal. Close this tab and try again.",
    pasteConfirmTitle: "Paste into the terminal?",
    pasteConfirmBody:
      "This paste has {{lines}} lines and may run commands immediately.",
    pasteConfirmAccept: "Paste",
    pasteConfirmCancel: "Cancel",
  },
} as const;
