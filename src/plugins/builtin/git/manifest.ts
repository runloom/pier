import type { PluginManifest } from "@shared/contracts/plugin.ts";
import { GIT_WORKTREE_BRANCH_NAME_PROMPT_SETTING_KEY } from "./settings.ts";

// 插件 id 属于插件包自身(与 files 插件对称);宿主侧经 registry entry 的
// manifest.id 消费,不再从 shared 契约取常量。
export const GIT_PLUGIN_ID = "pier.git";
export const GIT_CHANGES_PANEL_ID = "pier.git.changes";
/** 底栏分支身份项（下拉入口）；溢出时 pinned。 */
export const GIT_WORKTREE_STATUS_ITEM_ID = "pier.worktree.status";
/** 底栏更改 ± 项；可被溢出整项隐藏。 */
export const GIT_CHANGES_STATUS_ITEM_ID = "pier.git.status.changes";
/** 底栏同步 ↑↓ 项；可被溢出整项隐藏。 */
export const GIT_SYNC_STATUS_ITEM_ID = "pier.git.status.sync";

export const GIT_PLUGIN_MANIFEST: PluginManifest = {
  apiVersion: 1,
  commands: [
    {
      category: "Worktree",
      id: "pier.worktree.list",
      permissions: ["worktree:read", "workspace:open"],
      title: "List Worktrees",
    },
    {
      category: "Worktree",
      id: "pier.worktree.create",
      permissions: [
        "worktree:read",
        "worktree:write",
        "environment:read",
        "ai:invoke",
      ],
      title: "Create Worktree",
    },
    {
      category: "Worktree",
      id: "pier.worktree.delete",
      permissions: ["worktree:read", "worktree:write", "environment:read"],
      title: "Delete Worktrees...",
    },
    {
      category: "Worktree",
      id: "pier.worktree.prune",
      permissions: ["worktree:read", "worktree:write"],
      title: "Prune Stale Worktrees",
    },
    {
      category: "Git",
      id: "pier.git.switchBranch",
      permissions: ["git:read", "git:write"],
      title: "Git: Switch Branch...",
    },
    {
      category: "Git",
      id: "pier.git.merge",
      permissions: ["git:read", "git:write"],
      title: "Git: Merge Branch...",
    },
    {
      category: "Git",
      id: "pier.git.mergeAbort",
      permissions: ["git:write"],
      title: "Git: Abort Merge",
    },
    {
      category: "Git",
      id: "pier.git.stash",
      permissions: ["git:write"],
      title: "Git: Stash",
    },
    {
      category: "Git",
      id: "pier.git.stashApply",
      permissions: ["git:read", "git:write"],
      title: "Git: Apply Stash...",
    },
    {
      category: "Git",
      id: "pier.git.stashDrop",
      permissions: ["git:read", "git:write"],
      title: "Git: Drop Stash...",
    },
    {
      category: "Git",
      id: "pier.git.stashIncludeUntracked",
      permissions: ["git:write"],
      title: "Git: Stash (Include Untracked)",
    },
    {
      category: "Git",
      id: "pier.git.stashPop",
      permissions: ["git:read", "git:write"],
      title: "Git: Pop Stash...",
    },
    {
      category: "Git",
      id: "pier.git.rebase",
      permissions: ["git:read", "git:write"],
      title: "Git: Rebase Branch...",
    },
    {
      category: "Git",
      id: "pier.git.rebaseAbort",
      permissions: ["git:write"],
      title: "Git: Abort Rebase",
    },
    {
      category: "Git",
      id: "pier.git.rebaseContinue",
      permissions: ["git:write"],
      title: "Git: Continue Rebase",
    },
    {
      category: "Git",
      id: "pier.git.cherryPick",
      permissions: ["git:read", "git:write"],
      title: "Git: Cherry-pick Commit...",
    },
    {
      category: "Git",
      id: "pier.git.cherryPickAbort",
      permissions: ["git:write"],
      title: "Git: Abort Cherry-pick",
    },
    {
      category: "Git",
      id: "pier.git.cherryPickContinue",
      permissions: ["git:write"],
      title: "Git: Continue Cherry-pick",
    },
    {
      category: "Git",
      id: "pier.git.revert",
      permissions: ["git:read", "git:write"],
      title: "Git: Revert Commit...",
    },
    {
      category: "Git",
      id: "pier.git.revertAbort",
      permissions: ["git:write"],
      title: "Git: Abort Revert",
    },
    {
      category: "Git",
      id: "pier.git.revertContinue",
      permissions: ["git:write"],
      title: "Git: Continue Revert",
    },
    {
      category: "Git",
      id: "pier.git.undoLastCommit",
      permissions: ["git:write"],
      title: "Git: Undo Last Commit",
    },
    {
      category: "Git",
      id: "pier.git.pull",
      permissions: ["git:write"],
      title: "Git: Pull",
    },
    {
      category: "Git",
      id: "pier.git.push",
      permissions: ["git:write"],
      title: "Git: Push",
    },
    {
      category: "Git",
      id: "pier.git.sync",
      permissions: ["git:write"],
      title: "Git: Sync",
    },
    {
      category: "Git",
      id: "pier.git.viewChanges",
      permissions: ["git:read", "panel:open"],
      title: "Git: Open Review",
    },
    {
      category: "Git",
      id: "pier.git.review.openFile",
      permissions: ["file:read", "panel:open"],
      title: "Git: Open File",
    },
    {
      category: "Git",
      id: "pier.git.review.openInEditor",
      permissions: ["file:read", "panel:open"],
      title: "Git: Jump to Source",
    },
    {
      category: "Git",
      id: "pier.git.review.stageFile",
      permissions: ["git:write"],
      title: "Git: Stage",
    },
    {
      category: "Git",
      id: "pier.git.review.unstageFile",
      permissions: ["git:write"],
      title: "Git: Unstage",
    },
    {
      category: "Git",
      id: "pier.git.review.discardFile",
      permissions: ["git:write"],
      title: "Git: Discard Changes",
    },
    {
      category: "Git",
      id: "pier.git.review.toggleTree",
      permissions: [],
      title: "Toggle Changed Files Tree",
    },
    {
      category: "Git",
      id: "pier.git.review.expandAll",
      permissions: [],
      title: "Expand Folders",
    },
    {
      category: "Git",
      id: "pier.git.review.collapseFolders",
      permissions: [],
      title: "Collapse Folders",
    },
    {
      category: "Git",
      id: "pier.git.review.copyPath",
      permissions: ["file:read"],
      title: "Git: Copy Path",
    },
    {
      category: "Git",
      id: "pier.git.review.copyRelativePath",
      permissions: ["file:read"],
      title: "Git: Copy Relative Path",
    },
    {
      category: "Git",
      id: "pier.git.review.revealInFinder",
      permissions: ["file:read"],
      title: "Git: Reveal in Finder",
    },
  ],

  configuration: {
    properties: {
      "pier.git.statusItem.showDirtyIndicator": {
        default: true,
        description:
          "Show dirtiness on the status bar branch icon. Open the Git dropdown for change details.",
        order: 10,
        type: "boolean",
      },
      "pier.git.statusItem.showChangesStatus": {
        default: true,
        description:
          "Show the changes item (colored +/− line stats; click opens the review panel) in the terminal status bar.",
        order: 11,
        type: "boolean",
      },
      "pier.git.statusItem.showSyncStatus": {
        default: true,
        description:
          "Show the sync item (ahead/behind counts with one-click sync) in the terminal status bar.",
        order: 12,
        type: "boolean",
      },
      "pier.git.statusItem.confirmSync": {
        default: true,
        description:
          "Ask for confirmation before syncing (pull then push) from the status bar sync item.",
        order: 13,
        type: "boolean",
      },
      [GIT_WORKTREE_BRANCH_NAME_PROMPT_SETTING_KEY]: {
        default: "",
        description:
          "Optional. Leave blank for the default template. {{task}} becomes the task description; {{projectRootPath}} becomes the project root path.",
        multiline: true,
        order: 20,
        placeholder:
          "Generate a short branch name for {{task}}. Follow rules in {{projectRootPath}}. Output only the branch name.",
        resettable: false,
        type: "string",
      },
    },
  },
  workbenchWidgets: [],
  settingsPages: [],
  description: "Built-in git command palette and terminal status support.",
  engines: { pier: ">=0.1.0" },
  homepage: "https://github.com/runloom/pier",
  id: GIT_PLUGIN_ID,
  localization: {
    defaultLocale: "en",
    files: {
      en: "locales/en.json",
      "zh-CN": "locales/zh-CN.json",
    },
    locales: ["en", "zh-CN"],
  },
  name: "Git",
  panels: [
    {
      component: GIT_CHANGES_PANEL_ID,
      id: GIT_CHANGES_PANEL_ID,
      permissions: ["git:read"],
      title: "Changes",
    },
  ],
  permissions: [
    "command:register",
    "worktree:read",
    "worktree:write",
    "environment:read",
    "workspace:open",
    "git:read",
    "git:write",
    "file:read",
    "panel:open",
    "panel:register",
    "ai:invoke",
  ],
  publisher: "Pier",
  repository: "https://github.com/runloom/pier",
  source: { kind: "builtin" },
  terminalStatusItems: [
    {
      alignment: "right",
      id: GIT_WORKTREE_STATUS_ITEM_ID,
      // 右组 reverse 后：高 order 更靠左（内）→ branch · changes · sync · project
      order: 12,
      overflowPinned: true,
      overflowPriority: 0,
      permissions: ["worktree:read", "workspace:open"],
      title: "Git Branch",
    },
    {
      alignment: "right",
      id: GIT_CHANGES_STATUS_ITEM_ID,
      order: 11,
      overflowPriority: 30,
      permissions: ["git:read", "panel:open"],
      title: "Git Changes",
    },
    {
      alignment: "right",
      id: GIT_SYNC_STATUS_ITEM_ID,
      order: 10,
      overflowPriority: 20,
      permissions: ["git:read", "git:write"],
      title: "Git Sync",
    },
  ],
  version: "1.0.0",
};
