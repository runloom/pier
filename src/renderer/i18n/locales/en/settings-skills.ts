/** Skills section copy (design v9 §7); split from settings.ts (file-size cap). */
export const settingsSkills = {
  description:
    "Manage agent skills for this project. Does not change your Mac-wide skill folders.",
  emptyTitle: "No project skills",
  detailEmptyTitle: "No skills in this project yet",
  detailEmptyDescription:
    'Import from a folder or create one. New skills stay off until you turn them on. Skills already installed by other tools show under "In project".',
  emptyDescription: "Choose a project, then import a local skill directory.",
  searchPlaceholder: "Search skills",
  filterAll: "All",
  filterGroupLabel: "Filter skills by source",
  filterManaged: "Managed by me",
  filterProject: "In project",
  filterUserGlobal: "On this Mac",
  contentTitle: "SKILL.md content",
  metadataTitle: "Details",
  matrixNotInstalled_one: "{{count}} agent that is not installed is hidden.",
  matrixNotInstalled_other:
    "{{count}} agents that are not installed are hidden.",
  matrixAllSameState_one: "The installed agent is {{state}}.",
  matrixAllSameState_other: "All {{count}} installed agents: {{state}}.",
  matrixGroupState_one: "{{count}} agent: {{state}}",
  matrixGroupState_other: "{{count}} agents: {{state}}",
  contentUnavailable: "Could not read this skill's content.",
  contentTruncated: "Content is longer than 1 MB; showing the beginning.",
  readOnlyNotice: "Maintained in its own folder. Pier never changes it.",
  reload: "Reload",
  reloadRequired: "Skills changed outside Pier.",
  reloadRequiredHint: "Reload to see the current files before trying again.",
  repairFailed: "Could not make skills available to every agent",
  repairFailedBody:
    "The repair did not complete. Try again; if it keeps failing, reload the project.",
  importTitle: "Add skill",
  previewTemplateTitle: "Preview the new skill",
  importCancel: "Cancel",
  importFailed: "Could not import skill",
  importInvalid: "Import result was invalid. Try again.",
  launchBlockedTitle: "Skills aren’t ready yet",
  launchBlockedBody:
    "One or more skills are not ready. Open skill settings to fix them.",
  launchOperationBusy:
    "Another skill update is still finishing. Wait a moment, then try again.",
  launchIssueProjection:
    "Agents cannot use {{skill}} yet. Open skill settings and retry.",
  launchIssueTargetModified:
    "{{target}} was changed outside Pier. Open skill settings to resolve it.",
  launchIssueDuplicate:
    "An agent can find the same skill in more than one folder. Open skill settings to choose one source.",
  launchOpenSettings: "Open skill settings",
  launchAnyway: "Launch anyway",
  launchCancel: "Cancel",
  backToList: "Back to projects",
  currentBadge: "Current",
  deleteSkill: "Delete this skill",
  enableSkill: "Enable skill",
  deliveryClaude: "Also available to Claude Code",
  deliveryClaudeHint:
    "Turned-on skills already go to your usual agents. Turn this on to include Claude Code too.",
  listTitle_one: "Skill ({{count}})",
  listTitle_other: "Skills ({{count}})",
  skillCount_one: "{{count}} managed skill",
  skillCount_other: "{{count}} managed skills",
  loadFailed: "Could not load skills",
  projectsTitle: "Projects",
  addProject: "Add project",
  addProjectFailed: "Could not add the project",
  addProjectFailedBody: "Choose the project folder again and retry.",
  projectsLoadFailed: "Could not load projects",
  projectsLoadFailedBody: "Retry to load the project list.",
  noResultsTitle: "No matching skills",
  noResultsDescription: "Adjust the search or filter to see more skills.",
  clearFilters: "Clear search and filters",
  resultCount_one: "{{shown}} of {{total}} skill",
  resultCount_other: "{{shown}} of {{total}} skills",
  addSkill: "Add skill",
  addFromFolder: "Import from folder",
  addBlank: "New skill",
  blankIdTitle: "New skill id",
  blankIdBody:
    "Lowercase letters, digits, and dashes (for example review-guide).",
  blankDescriptionTitle: "Skill description",
  blankDescriptionBody:
    "One sentence describing when agents should use this skill.",
  open: "Open",
  unmanagedBadge: "In project",
  userGlobalBadge: "On this Mac",
  importAsManaged: "Manage with Pier",
  systemBadge: "Pier system",
  managedSource: {
    localImport: "Added locally",
    projectDiscoveryImport: "Imported from project",
    gitDeclared: "Declared in the repository",
  },
  effectDiscoverable: "Available",
  effectNotProjected: "Not enabled",
  effectShadowed: "Hidden by a same-named skill on this Mac",
  effectOverridden: "Another copy takes priority",
  effectDuplicate: "Discovered more than once",
  effectRootNotScanned: "Does not scan this folder",
  effectNotInstalled: "Not installed",
  effectUnknownVersion: "Needs a version check",
  skillOn: "On",
  skillOff: "Off",
  leaveEditTitle: "Discard unsaved skill edits?",
  leaveEditBody: "Unsaved changes to skill content will be lost.",
  confirmGitDeleteTitle: "Delete the agent skill folder at {{target}}?",
  confirmGitDeleteBody:
    "This path is tracked by Git. Deleting it will show up as a deletion in the repository changes.",
  confirmContentDeleteTitle: "Delete skill {{skill}}?",
  confirmContentDeleteBody:
    "Removes the skill from this project. Turning the switch off only hides it from agents. This cannot be undone.",
  issueUnmanagedConflict:
    "{{target}} already has a same-named directory that Pier does not manage. Pier will not overwrite it. Remove that directory first, or cancel and keep using the original.",
  issueDuplicateDiscovery:
    "With Claude Code delivery on, {{agent}} discovers same-named skills in multiple directories. Turn Claude Code delivery off to resolve.",
  issueIdentityChanged:
    "The project directory was moved or replaced. Go back to the project list and open it again.",
  issueLibraryDrift:
    "The content of {{skill}} was modified outside Pier. Open the skill to use the current files, or turn it off or delete it.",
  issueMissingSource:
    "The library content of {{skill}} is missing (.pier/skills/library/{{skill}}). Delete the skill or import it again.",
  issueInvalidManifest:
    "This project's skill list is damaged. Fix or restore .pier/skills/manifest.json, then reload.",
  issueLedgerCorrupt:
    "Pier's local skill records for this project are damaged. Reload the project, or remove the damaged records and try again.",
  issueRecoveryBlocked:
    "A previous skill change did not finish cleanly. Retry, or reload the project.",
  issueGeneric:
    "Agents cannot use the affected skills yet. Resolve the shown issue and retry.",
  driftBadge: "Modified outside Pier",
  missingBadge: "Content missing",
  actionFailed: "Could not complete this action",
  actionFailedBody: "Reload the project and try again.",
  actionBlockedTitle: "This action cannot be completed",
  actionBlockedBody: "Resolve the issue shown for this skill, then try again.",
  actionDangerConfirmTitle: "Continue with this change?",
  actionDangerConfirmBody:
    "This changes files managed by Pier. Confirm the affected skill before continuing.",
  projectionIncomplete: "Some agents are not ready yet",
  projectionIncompleteBody:
    "The skill was saved, but some agents cannot use it yet. Retry. If it still fails, reload the project.",
  retry: "Retry",
  operationNotApplied:
    "The previous action did not finish. Reload the project, then retry the action.",
  applyIndeterminate:
    "Confirming disk state… editing is paused until this finishes.",
  skillDetailBack: "Back to skills",
  editSave: "Save",
  editDiscard: "Discard changes",
  editSaved: "Saved",
  editFailed: "Couldn't save skill",
  driftTitle: "This skill was changed outside Pier",
  driftBody:
    "Files on disk no longer match what Pier recorded. Use the current files, or delete the skill.",
  driftUseCurrent: "Use current files",
  matrixTitle: "Which agents can use this",
  metadataFiles_one: "{{count}} file · {{size}}",
  metadataFiles_other: "{{count}} files · {{size}}",
  riskTitle: "Risk notes",
  riskExecutables_one: "{{count}} executable file",
  riskExecutables_other: "{{count}} executable files",
  riskDynamic_one: "{{count}} dynamic command trace",
  riskDynamic_other: "{{count}} dynamic command traces",
  riskFrontmatter: "Declares {{keys}}",
  riskDisclaimer:
    "Pier checks structure only. It does not verify that this content is safe.",
  copyPath: "Copy library path",
  copySuccess: "Copied",
  copyFailed: "Couldn't copy",
  importSource: "Source: {{path}}",
  importReadOnlyCopy:
    "This is a read-only copy. The original directory is not changed or removed.",
  importExpired: "This import expired. Choose the source again.",
  candidateExpiredBody:
    "Go back and choose the source again to create a fresh preview.",
  conflictExists:
    "A managed skill with id {{id}} already exists. Overwriting or renaming is not supported.",
  conflictExistsBody:
    "Return to the skill list and open the existing skill, or choose a different source.",
  conflictReloadBody:
    "Files changed while this action was open. Reload the skill list before choosing the action again.",
  identityChangedBody:
    "Go back to the project list and reopen this project before trying again.",
  reloadAndReturn: "Reload and return",
  addSkillCommit: "Add skill",
  dismiss: "Dismiss",
  leaveBlocked: "Still confirming disk state. Try leaving again in a moment.",
  importAddedTitle: "Added “{{name}}” (off)",
  importAddedBody: "Turn it on when you want agents to use it.",
  sessionRefreshTitle: "Start a new session",
  sessionRefreshBody:
    "Running sessions may keep older content. Start a new session when you need the updated skills.",
  gitStatusTitle: "Git status for discovery paths",
  gitIgnoreHint:
    "Prefer not committing .agents/skills/ and .claude/skills/. Copy ignore lines into .gitignore if you want.",
  copyGitIgnore: "Copy ignore lines",
  gitState: {
    absent: "Absent",
    ignored: "Ignored",
    untracked: "Untracked",
    tracked: "Tracked",
    unknown: "Unknown",
  },
  confirmDeleteAction: "Delete",
  launchCancelledPanel:
    "Launch cancelled: skills are not ready for this project. Open skill settings, then start a new terminal.",
  sourceTemplate: "Added locally",
  effectSummaryDiscoverable_one: "Available to {{count}} agent",
  effectSummaryDiscoverable_other: "Available to {{count}} agents",
  effectSummaryNone: "Not available to agents",
  openProjectMissing: "Couldn't open project skills",
  blankDialogTitle: "New blank skill",
  blankIdInvalid:
    "Use lowercase letters, digits, and dashes, starting with a letter or digit.",
  create: "Create",
  importFailedBody: "Choose the skill source again and retry.",
  loadFailedBody: "Reload the project or return to the project list.",
} as const;
