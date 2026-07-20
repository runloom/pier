import type { PluginManifest } from "@shared/contracts/plugin.ts";
import { GIT_WORKTREE_BRANCH_NAME_PROMPT_SETTING_KEY } from "./settings.ts";

// 插件 id 属于插件包自身(与 files 插件对称);宿主侧经 registry entry 的
// manifest.id 消费,不再从 shared 契约取常量。
export const GIT_PLUGIN_ID = "pier.git";
export const GIT_CHANGES_PANEL_ID = "pier.git.changes";

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
      id: "pier.git.review.openFile",
      permissions: ["file:read", "panel:open"],
      title: "Git: Open File",
    },
    {
      category: "Git",
      id: "pier.git.review.stageFile",
      permissions: ["git:write"],
      title: "Git: Stage Changes",
    },
    {
      category: "Git",
      id: "pier.git.review.unstageFile",
      permissions: ["git:write"],
      title: "Git: Unstage Changes",
    },
    {
      category: "Git",
      id: "pier.git.review.discardFile",
      permissions: ["git:write"],
      title: "Git: Discard Changes",
    },
  ],
  configuration: {
    properties: {
      "pier.git.statusItem.showDirtyIndicator": {
        default: true,
        description:
          "Show working tree change counts and line delta in the worktree status item.",
        order: 10,
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
      id: "pier.worktree.status",
      order: 10,
      permissions: ["worktree:read", "workspace:open"],
      title: "Worktree Status",
    },
  ],
  version: "1.0.0",
};
