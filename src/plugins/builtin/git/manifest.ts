import type { PluginManifest } from "@shared/contracts/plugin.ts";
import {
  GIT_COMMIT_PUSH_AFTER_SETTING_KEY,
  GIT_WORKTREE_BRANCH_NAME_PROMPT_SETTING_KEY,
} from "./settings.ts";

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
      category: "git",
      id: "pier.git.switchBranch",
      permissions: ["git:read", "git:write"],
      title: "GIT: Switch Branch...",
    },
    {
      category: "git",
      id: "pier.git.merge",
      permissions: ["git:read", "git:write"],
      title: "GIT: Merge Branch...",
    },
    {
      category: "git",
      id: "pier.git.mergeAbort",
      permissions: ["git:write"],
      title: "GIT: Abort Merge",
    },
    {
      category: "git",
      id: "pier.git.stash",
      permissions: ["git:write"],
      title: "GIT: Stash",
    },
    {
      category: "git",
      id: "pier.git.stashApply",
      permissions: ["git:read", "git:write"],
      title: "GIT: Apply Stash...",
    },
    {
      category: "git",
      id: "pier.git.stashDrop",
      permissions: ["git:read", "git:write"],
      title: "GIT: Drop Stash...",
    },
    {
      category: "git",
      id: "pier.git.stashIncludeUntracked",
      permissions: ["git:write"],
      title: "GIT: Stash (Include Untracked)",
    },
    {
      category: "git",
      id: "pier.git.stashPop",
      permissions: ["git:read", "git:write"],
      title: "GIT: Pop Stash...",
    },
    {
      category: "git",
      id: "pier.git.rebase",
      permissions: ["git:read", "git:write"],
      title: "GIT: Rebase Branch...",
    },
    {
      category: "git",
      id: "pier.git.rebaseAbort",
      permissions: ["git:write"],
      title: "GIT: Abort Rebase",
    },
    {
      category: "git",
      id: "pier.git.rebaseContinue",
      permissions: ["git:write"],
      title: "GIT: Continue Rebase",
    },
    {
      category: "git",
      id: "pier.git.cherryPick",
      permissions: ["git:read", "git:write"],
      title: "GIT: Cherry-pick Commit...",
    },
    {
      category: "git",
      id: "pier.git.cherryPickAbort",
      permissions: ["git:write"],
      title: "GIT: Abort Cherry-pick",
    },
    {
      category: "git",
      id: "pier.git.cherryPickContinue",
      permissions: ["git:write"],
      title: "GIT: Continue Cherry-pick",
    },
    {
      category: "git",
      id: "pier.git.revert",
      permissions: ["git:read", "git:write"],
      title: "GIT: Revert Commit...",
    },
    {
      category: "git",
      id: "pier.git.revertAbort",
      permissions: ["git:write"],
      title: "GIT: Abort Revert",
    },
    {
      category: "git",
      id: "pier.git.revertContinue",
      permissions: ["git:write"],
      title: "GIT: Continue Revert",
    },
    {
      category: "git",
      id: "pier.git.commit",
      permissions: ["git:write"],
      title: "GIT: Commit",
    },
    {
      category: "git",
      id: "pier.git.undoLastCommit",
      permissions: ["git:write"],
      title: "GIT: Undo Last Commit",
    },
    {
      category: "git",
      id: "pier.git.fetch",
      permissions: ["git:write"],
      title: "GIT: Fetch", // i18n: commands.pier.git.fetch
    },
    {
      category: "git",
      id: "pier.git.pull",
      permissions: ["git:write"],
      title: "GIT: Pull",
    },
    {
      category: "git",
      id: "pier.git.push",
      permissions: ["git:write"],
      title: "GIT: Push",
    },
    {
      category: "git",
      id: "pier.git.publish",
      permissions: ["git:write"],
      title: "GIT: Publish Branch", // i18n: commands.pier.git.publish
    },
    {
      category: "git",
      id: "pier.git.sync",
      permissions: ["git:write"],
      title: "GIT: Sync",
    },
    {
      category: "git",
      id: "pier.git.viewChanges",
      permissions: ["git:read", "panel:open"],
      title: "GIT: Open Review",
    },
    {
      category: "git",
      id: "pier.git.review.openFile",
      permissions: ["file:read", "panel:open"],
      title: "GIT: Open File",
    },
    {
      category: "git",
      id: "pier.git.review.openInEditor",
      permissions: ["file:read", "panel:open"],
      title: "GIT: Jump to Source",
    },
    {
      category: "git",
      id: "pier.git.review.stageFile",
      permissions: ["git:write"],
      title: "GIT: Stage",
    },
    {
      category: "git",
      id: "pier.git.review.unstageFile",
      permissions: ["git:write"],
      title: "GIT: Unstage",
    },
    {
      category: "git",
      id: "pier.git.review.discardFile",
      permissions: ["git:write"],
      title: "GIT: Discard Changes",
    },
    {
      category: "git",
      id: "pier.git.review.toggleTree",
      permissions: [],
      title: "Toggle Changed Files Tree",
    },
    {
      category: "git",
      id: "pier.git.review.expandAll",
      permissions: [],
      title: "Expand Folders",
    },
    {
      category: "git",
      id: "pier.git.review.collapseFolders",
      permissions: [],
      title: "Collapse Folders",
    },
    {
      category: "git",
      id: "pier.git.review.openDirectory",
      permissions: ["file:read", "panel:open"],
      title: "GIT: Open Directory",
    },
    {
      category: "git",
      id: "pier.git.review.copyPath",
      permissions: ["file:read"],
      title: "GIT: Copy Path",
    },
    {
      category: "git",
      id: "pier.git.review.copyRelativePath",
      permissions: ["file:read"],
      title: "GIT: Copy Relative Path",
    },
    {
      category: "git",
      id: "pier.git.review.copyPathWithRange",
      permissions: ["file:read"],
      title: "GIT: Copy Path and Selected Lines",
    },
    {
      category: "git",
      id: "pier.git.review.revealInFinder",
      permissions: ["file:read"],
      title: "GIT: Reveal in Finder",
    },
  ],

  configuration: {
    properties: {
      "pier.git.statusItem.showDirtyIndicator": {
        default: true,
        description:
          "Show dirtiness on the status bar branch icon. Open the git dropdown for change details.",
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
      [GIT_COMMIT_PUSH_AFTER_SETTING_KEY]: {
        default: false,
        description:
          "When the commit dialog opens, start with push after commit turned on. You can still turn it off for this commit.",
        order: 14,
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
  canvasActions: [],
  dataProjections: [],
  settingsPages: [],
  description: "Built-in git command palette and terminal status support.",
  engines: { pier: ">=0.1.0" },
  homepage: "https://github.com/runloom/pier",
  id: GIT_PLUGIN_ID,
  localization: {
    defaultLocale: "en",
    files: {
      en: "locales/en.json",
      ja: "locales/ja.json",
      ko: "locales/ko.json",
      "zh-CN": "locales/zh-CN.json",
    },
    locales: ["en", "ja", "ko", "zh-CN"],
  },
  name: "GIT",
  panels: [
    {
      component: GIT_CHANGES_PANEL_ID,
      id: GIT_CHANGES_PANEL_ID,
      permissions: ["comments:read", "comments:write", "git:read"],
      title: "Changes",
    },
  ],
  permissions: [
    "command:register",
    "worktree:read",
    "worktree:write",
    "environment:read",
    "workspace:open",
    "comments:read",
    "comments:write",
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
      title: "git Branch",
    },
    {
      alignment: "right",
      id: GIT_CHANGES_STATUS_ITEM_ID,
      order: 11,
      overflowPriority: 30,
      permissions: ["git:read", "panel:open"],
      title: "git Changes",
    },
    {
      alignment: "right",
      id: GIT_SYNC_STATUS_ITEM_ID,
      order: 10,
      overflowPriority: 20,
      permissions: ["git:read", "git:write"],
      title: "git Sync",
    },
  ],
  version: "1.0.0",
};
