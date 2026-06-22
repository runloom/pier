import i18next from "i18next";
import { en } from "./locales/en.ts";
import { zhCN } from "./locales/zh-cn.ts";

export const DEFAULT_LOCALE = "zh-CN";
export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

let initialized = false;

export async function initI18n(): Promise<void> {
  if (initialized) {
    return;
  }
  await i18next.init({
    lng: DEFAULT_LOCALE,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    resources: {
      "zh-CN": { translation: zhCN },
      en: { translation: en },
    },
  });
  initialized = true;
}
