import type { PluginLocaleMessages } from "@shared/contracts/plugin.ts";
import en from "./en.json" with { type: "json" };
import ja from "./ja.json" with { type: "json" };
import ko from "./ko.json" with { type: "json" };
import zhCN from "./zh-CN.json" with { type: "json" };

export const MEMORY_PLUGIN_LOCALES = {
  en,
  ja,
  ko,
  zh: zhCN,
  "zh-CN": zhCN,
} satisfies Record<string, PluginLocaleMessages>;
