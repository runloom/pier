import type { PluginManifest } from "@shared/contracts/plugin.ts";

export const MEMORY_PLUGIN_ID = "pier.memory";
export const MEMORY_PROJECT_SETTINGS_ID = "pier.memory.project";

export const MEMORY_PLUGIN_MANIFEST = {
  apiVersion: 1,
  commands: [],
  canvasActions: [],
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
  panels: [],
  permissions: ["workspace:read", "file:read", "managedAssets:write"],
  projectSettings: [{ id: MEMORY_PROJECT_SETTINGS_ID }],
  publisher: "Pier",
  settingsPages: [],
  source: { kind: "builtin" },
  terminalStatusItems: [],
  version: "1.0.0",
} satisfies PluginManifest;
