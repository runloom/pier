import {
  type PluginManifest,
  WORKTREE_PLUGIN_ID as SHARED_WORKTREE_PLUGIN_ID,
} from "@shared/contracts/plugin.ts";

export const WORKTREE_PLUGIN_MANIFEST: PluginManifest = {
  apiVersion: 1,
  commands: [
    {
      category: "Worktree",
      id: "pier.worktree.list",
      permissions: ["worktree:read", "workspace:open"],
      title: "Worktree: List",
    },
    {
      category: "Worktree",
      id: "pier.worktree.create",
      permissions: ["worktree:write"],
      title: "Worktree: Create",
    },
    {
      category: "Worktree",
      id: "pier.worktree.delete",
      permissions: ["worktree:write"],
      title: "Worktree: Delete...",
    },
  ],
  description: "Built-in worktree command palette and terminal status support.",
  engines: { pier: ">=0.1.0" },
  id: SHARED_WORKTREE_PLUGIN_ID,
  localization: {
    defaultLocale: "en",
    files: {
      en: "locales/en.json",
      "zh-CN": "locales/zh-CN.json",
    },
    locales: ["en", "zh-CN"],
  },
  name: "Worktree",
  panels: [],
  permissions: ["command:register", "worktree:read", "workspace:open"],
  publisher: "Pier",
  source: { kind: "builtin" },
  version: "1.0.0",
};
