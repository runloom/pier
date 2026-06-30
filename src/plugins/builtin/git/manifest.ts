import {
  type PluginManifest,
  GIT_PLUGIN_ID as SHARED_GIT_PLUGIN_ID,
} from "@shared/contracts/plugin.ts";

export const GIT_PLUGIN_MANIFEST: PluginManifest = {
  apiVersion: 1,
  commands: [
    {
      category: "Git",
      id: "pier.worktree.list",
      permissions: ["worktree:read", "workspace:open"],
      title: "Worktree: List",
    },
    {
      category: "Git",
      id: "pier.worktree.create",
      permissions: [],
      title: "Worktree: Create",
    },
    {
      category: "Git",
      id: "pier.worktree.delete",
      permissions: [],
      title: "Worktree: Delete...",
    },
    {
      category: "Git",
      id: "pier.git.changes.open",
      permissions: ["panel:open"],
      title: "Git: Open Changes",
    },
  ],
  description: "Built-in git command palette and terminal status support.",
  engines: { pier: ">=0.1.0" },
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
    "workspace:open",
    "panel:register",
    "panel:open",
  ],
  publisher: "Pier",
  source: { kind: "builtin" },
  terminalStatusItems: [
    {
      id: "pier.worktree.status",
      permissions: ["worktree:read", "workspace:open"],
      title: "Worktree Status",
    },
  ],
  version: "1.0.0",
};
