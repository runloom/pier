import type { PluginManifest } from "@shared/contracts/plugin.ts";

export const FILES_PLUGIN_ID = "pier.files";
export const FILES_PANEL_ID = "pier.files.explorer";

export const FILES_PLUGIN_MANIFEST = {
  apiVersion: 1,
  commands: [],
  missionControlWidgets: [],
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
      component: FILES_PANEL_ID,
      id: FILES_PANEL_ID,
      permissions: ["file:read"],
      title: "Files",
    },
  ],
  permissions: ["file:read", "panel:register"],
  publisher: "Pier",
  source: { kind: "builtin" },
  terminalStatusItems: [],
  version: "1.0.0",
} satisfies PluginManifest;
