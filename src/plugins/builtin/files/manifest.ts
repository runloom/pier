import type { PluginManifest } from "@shared/contracts/plugin.ts";

export const FILES_PLUGIN_ID = "pier.files";
export const FILES_FILE_PANEL_ID = "pier.files.filePanel";
export const FILES_OPEN_SELECTION_AS_MARKDOWN_COMMAND_ID =
  "pier.files.openSelectionAsMarkdown";

export const FILES_PLUGIN_MANIFEST = {
  apiVersion: 1,
  commands: [
    {
      category: "file",
      id: FILES_OPEN_SELECTION_AS_MARKDOWN_COMMAND_ID,
      permissions: ["terminal:read", "panel:open"],
      title: "Markdown Preview",
    },
  ],
  dashboardWidgets: [],
  engines: { pier: ">=0.1.0" },
  id: FILES_PLUGIN_ID,
  localization: {
    defaultLocale: "en",
    files: {
      en: "locales/en.json",
      "zh-CN": "locales/zh-CN.json",
    },
    locales: ["en", "zh-CN"],
  },
  name: "Files",
  panels: [
    {
      component: FILES_FILE_PANEL_ID,
      id: FILES_FILE_PANEL_ID,
      permissions: ["file:read", "file:write"],
      title: "File",
    },
  ],
  permissions: [
    "command:register",
    "panel:register",
    "panel:open",
    "file:read",
    "file:write",
    "terminal:read",
  ],
  publisher: "Pier",
  source: { kind: "builtin" },
  terminalStatusItems: [],
  version: "1.0.0",
} satisfies PluginManifest;
