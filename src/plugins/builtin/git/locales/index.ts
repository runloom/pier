import type { PluginLocaleMessages } from "@shared/contracts/plugin.ts";
import en from "./en.json" with { type: "json" };
import zhCN from "./zh-CN.json" with { type: "json" };

export const GIT_PLUGIN_LOCALES = {
  en,
  // i18next / OS may report `zh`; keep a language-prefix alias of zh-CN.
  zh: zhCN,
  "zh-CN": zhCN,
} satisfies Record<string, PluginLocaleMessages>;
