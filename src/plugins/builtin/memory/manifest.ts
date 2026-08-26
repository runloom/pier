import type { PluginManifest } from "@shared/contracts/plugin.ts";

export const MEMORY_PLUGIN_ID = "pier.memory";
export const MEMORY_PANEL_ID = "pier.memory.panel";

export const MEMORY_PLUGIN_MANIFEST = {
  apiVersion: 1,
  commands: [],
  dataProjections: [],
  description: "Project memory for coding agents.",
  engines: { pier: ">=0.1.0" },
  id: MEMORY_PLUGIN_ID,
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
  name: "Memory",
  panels: [
    {
      component: MEMORY_PANEL_ID,
      id: MEMORY_PANEL_ID,
      permissions: ["workspace:read", "panel:open"],
      title: "Project Memory",
    },
  ],
  permissions: [
    "workspace:read",
    "panel:register",
    "panel:open",
    "managedAssets:write",
  ],
  publisher: "Pier",
  settingsPages: [],
  source: { kind: "builtin" },
  terminalStatusItems: [],
  version: "1.0.0",
  workbenchWidgets: [],
} satisfies PluginManifest;
