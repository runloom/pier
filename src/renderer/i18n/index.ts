import i18next from "i18next";
import { FALLBACK_LOCALE, resolveLanguagePreference } from "./language.ts";
import { en } from "./locales/en.ts";
import { zhCN } from "./locales/zh-cn.ts";

let initialized = false;

export async function initI18n(): Promise<void> {
  if (initialized) {
    return;
  }
  const initialLocale = resolveLanguagePreference("system");
  document.documentElement.lang = initialLocale;
  await i18next.init({
    lng: initialLocale,
    fallbackLng: FALLBACK_LOCALE,
    interpolation: { escapeValue: false },
    resources: {
      "zh-CN": { translation: zhCN },
      en: { translation: en },
    },
  });
  initialized = true;
}
