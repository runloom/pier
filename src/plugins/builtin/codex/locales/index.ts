import type { PluginLocaleMessages } from "@shared/contracts/plugin.ts";
import en from "./en.json" with { type: "json" };
import zhCN from "./zh-CN.json" with { type: "json" };

export const CODEX_PLUGIN_LOCALES = {
  en,
  "zh-CN": zhCN,
} satisfies Record<string, PluginLocaleMessages>;
