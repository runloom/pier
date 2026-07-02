import {
  type PluginManifest,
  GIT_PLUGIN_ID as SHARED_GIT_PLUGIN_ID,
} from "@shared/contracts/plugin.ts";

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
      permissions: ["worktree:write"],
      title: "Create Worktree",
    },
    {
      category: "Worktree",
      id: "pier.worktree.delete",
      permissions: ["worktree:read", "worktree:write"],
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
      id: "pier.git.changes.open",
      permissions: ["panel:open"],
      title: "Git: Open Changes",
    },
    {
      category: "Git",
      id: "pier.git.merge",
      permissions: ["git:read", "git:write"],
      title: "Merge Branch...",
    },
    {
      category: "Git",
      id: "pier.git.mergeAbort",
      permissions: ["git:write"],
      title: "Abort Merge",
    },
    {
      category: "Git",
      id: "pier.git.stash",
      permissions: ["git:write"],
      title: "Stash",
    },
    {
      category: "Git",
      id: "pier.git.stashPop",
      permissions: ["git:read", "git:write"],
      title: "Pop Stash...",
    },
    {
      category: "Git",
      id: "pier.git.rebase",
      permissions: ["git:read", "git:write"],
      title: "Rebase Branch...",
    },
    {
      category: "Git",
      id: "pier.git.rebaseAbort",
      permissions: ["git:write"],
      title: "Abort Rebase",
    },
    {
      category: "Git",
      id: "pier.git.rebaseContinue",
      permissions: ["git:write"],
      title: "Continue Rebase",
    },
    {
      category: "Git",
      id: "pier.git.undoLastCommit",
      permissions: ["git:write"],
      title: "Undo Last Commit",
    },
  ],
  description: "Built-in git command palette and terminal status support.",
  engines: { pier: ">=0.1.0" },
  homepage: "https://github.com/runloom/pier",
  id: SHARED_GIT_PLUGIN_ID,
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
      id: "pier.git.changes",
      permissions: ["panel:register", "panel:open"],
      title: "Git Changes",
    },
  ],
  permissions: [
    "command:register",
    "worktree:read",
    "worktree:write",
    "workspace:open",
    "panel:register",
    "panel:open",
    "git:read",
    "git:write",
  ],
  publisher: "Pier",
  repository: "https://github.com/runloom/pier",
  source: { kind: "builtin" },
  terminalStatusItems: [
    {
      id: "pier.worktree.status",
      order: 10,
      permissions: ["worktree:read", "workspace:open"],
      title: "Worktree Status",
    },
  ],
  version: "1.0.0",
};
