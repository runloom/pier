import type { PluginManifest } from "@shared/contracts/plugin.ts";

export const CODEX_PLUGIN_ID = "pier.codex";
export const CODEX_ACCOUNTS_WIDGET_ID = "pier.codex.accounts";

export const CODEX_PLUGIN_MANIFEST = {
  apiVersion: 1,
  commands: [
    {
      category: "Codex",
      id: "pier.codex.switchAccount",
      permissions: ["account:read", "account:write"],
      title: "Codex: Switch Account",
    },
    {
      category: "Codex",
      id: "pier.codex.addAccount",
      permissions: ["account:write"],
      title: "Codex: Add Account",
    },
    {
      category: "Codex",
      id: "pier.codex.refreshUsage",
      permissions: ["account:read"],
      title: "Codex: Refresh Usage",
    },
  ],
  configuration: {
    properties: {
      "pier.codex.confirmSwitch": {
        default: true,
        description:
          "Show a confirmation dialog before switching the active Codex account.",
        order: 10,
        type: "boolean" as const,
      },
    },
  },
  dashboardWidgets: [
    {
      defaultSize: { w: 4, h: 4 },
      description: "Manage Codex accounts and monitor usage.",
      id: CODEX_ACCOUNTS_WIDGET_ID,
      maxSize: { w: 8, h: 10 },
      minSize: { w: 3, h: 3 },
      permissions: ["account:read"],
      title: "Codex Accounts",
    },
  ],
  description: "Built-in Codex account management and dashboard widget.",
  engines: { pier: ">=0.1.0" },
  id: CODEX_PLUGIN_ID,
  localization: {
    defaultLocale: "en",
    files: {
      en: "locales/en.json",
      "zh-CN": "locales/zh-CN.json",
    },
    locales: ["en", "zh-CN"],
  },
  name: "Codex Account Manager",
  panels: [],
  permissions: ["command:register", "account:read", "account:write"],
  publisher: "Pier",
  source: { kind: "builtin" },
  terminalStatusItems: [],
  version: "1.0.0",
} satisfies PluginManifest;
